import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { DomainError, normalizeCatalog, type CatalogCommand } from '@finanzas/domain';
import { type IdentityVerifier } from '../auth';
import { DATABASE, IDENTITY } from '../users';
import { UserDatabase } from '../database';
import { CatalogExecutor } from './executor';
import { mutateAccount } from './accounts';
import { mutateCategory } from './categories';
import { CatalogRead, type CatalogEntity } from './read';
import { commandSchema } from './openapi';
@Catch(DomainError)
class CatalogErrors implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost) {
    const code = error.code;
    const status =
      code === 'NOT_FOUND'
        ? 404
        : code.endsWith('_CONFLICT')
          ? 409
          : code.startsWith('BALANCE_')
            ? 503
            : 400;
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(status)
      .send({ error: code, requestId: host.switchToHttp().getRequest<{ id: string }>().id });
  }
}
class CatalogControllerBase {
  constructor(
    readonly identity: IdentityVerifier,
    readonly database: UserDatabase | null,
  ) {}
  async context(token: string | undefined) {
    const userId = await this.identity.verify(token);
    if (!this.database) throw new ServiceUnavailableException();
    return { userId, database: this.database };
  }
  async read(token: string | undefined, entity: CatalogEntity, query: unknown, id?: string) {
    const c = await this.context(token),
      read = new CatalogRead(c.database);
    return id ? read.get(c.userId, entity, id) : read.list(c.userId, entity, query);
  }
  async mutate(
    token: string | undefined,
    body: unknown,
    type: CatalogCommand['type'],
    id?: string,
  ) {
    const c = await this.context(token),
      envelope = normalizeCatalog(body);
    if (
      envelope.command.type !== type ||
      (id && (!('id' in envelope.command) || envelope.command.id !== id))
    )
      throw new DomainError('INVALID_COMMAND');
    return new CatalogExecutor(c.database).execute(c.userId, envelope, (client, command) =>
      type.startsWith('account.')
        ? mutateAccount(client, c.userId, command)
        : mutateCategory(client, c.userId, command),
    );
  }
}
@ApiTags('Accounts')
@ApiBearerAuth()
@UseFilters(CatalogErrors)
@ApiResponse({ status: 401, description: 'Sesión ausente, inválida o revocada' })
@ApiResponse({
  status: 409,
  description: 'VERSION_CONFLICT, IDEMPOTENCY_CONFLICT o ENTITY_CONFLICT',
})
@Controller('v1/accounts')
export class AccountsController extends CatalogControllerBase {
  constructor(
    @Inject(IDENTITY) identity: IdentityVerifier,
    @Inject(DATABASE) database: UserDatabase | null,
  ) {
    super(identity, database);
  }
  @Get()
  @ApiOperation({ summary: 'Cuentas propias; saldo exacto del ledger, sin sumar monedas' })
  @ApiQuery({ name: 'state', required: false, enum: ['active', 'inactive', 'all'] })
  @ApiQuery({ name: 'currency', required: false, enum: ['PEN', 'USD'] })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['savings', 'current', 'cash', 'wallet', 'investment', 'other'],
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'nextCursor de la página anterior, posición:UUID',
  })
  list(@Headers('authorization') token: string | undefined, @Query() q: unknown) {
    return this.read(token, 'account', q);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Cuenta propia, incluso inactiva; 404 si ajena o inexistente' })
  get(@Headers('authorization') token: string | undefined, @Param('id') id: string) {
    return this.read(token, 'account', {}, id);
  }
  @Post()
  @ApiBody({ schema: commandSchema('account.create') })
  @ApiOperation({
    summary: 'Crear cuenta activa con saldo cero; reintentos devuelven el resultado original',
  })
  create(@Headers('authorization') token: string | undefined, @Body() body: unknown) {
    return this.mutate(token, body, 'account.create');
  }
  @Patch(':id')
  @ApiBody({ schema: commandSchema('account.update') })
  @ApiOperation({ summary: 'Editar metadatos con baseVersion; moneda y saldo no editables' })
  update(
    @Headers('authorization') token: string | undefined,
    @Body() body: unknown,
    @Param('id') id: string,
  ) {
    return this.mutate(token, body, 'account.update', id);
  }
}
@ApiTags('Categories')
@ApiBearerAuth()
@UseFilters(CatalogErrors)
@ApiResponse({ status: 401, description: 'Sesión ausente, inválida o revocada' })
@ApiResponse({
  status: 409,
  description: 'VERSION_CONFLICT, IDEMPOTENCY_CONFLICT o ENTITY_CONFLICT',
})
@Controller('v1/categories')
export class CategoriesController extends CatalogControllerBase {
  constructor(
    @Inject(IDENTITY) identity: IdentityVerifier,
    @Inject(DATABASE) database: UserDatabase | null,
  ) {
    super(identity, database);
  }
  @Get()
  @ApiOperation({ summary: 'Categorías privadas; catálogo plano, sin efecto contable' })
  @ApiQuery({ name: 'state', required: false, enum: ['active', 'archived', 'all'] })
  @ApiQuery({ name: 'kind', required: false, enum: ['expense', 'income'] })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor de la página anterior' })
  list(@Headers('authorization') token: string | undefined, @Query() q: unknown) {
    return this.read(token, 'category', q);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Categoría propia, incluso archivada; 404 si ajena o inexistente' })
  get(@Headers('authorization') token: string | undefined, @Param('id') id: string) {
    return this.read(token, 'category', {}, id);
  }
  @Post('initialize')
  @ApiBody({ schema: commandSchema('category.initialize') })
  @ApiOperation({ summary: 'Copiar plantillas faltantes sin sobrescribir personalizaciones' })
  initialize(@Headers('authorization') token: string | undefined, @Body() body: unknown) {
    return this.mutate(token, body, 'category.initialize');
  }
  @Post()
  @ApiBody({ schema: commandSchema('category.create') })
  @ApiOperation({ summary: 'Crear categoría personalizada propia' })
  create(@Headers('authorization') token: string | undefined, @Body() body: unknown) {
    return this.mutate(token, body, 'category.create');
  }
  @Patch(':id')
  @ApiBody({ schema: commandSchema('category.update') })
  @ApiOperation({ summary: 'Renombrar, ordenar, archivar o reactivar con versión esperada' })
  update(
    @Headers('authorization') token: string | undefined,
    @Body() body: unknown,
    @Param('id') id: string,
  ) {
    return this.mutate(token, body, 'category.update', id);
  }
}
