import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
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
import { DomainError } from '@finanzas/domain';
import type { IdentityVerifier } from '../auth';
import { DATABASE, IDENTITY } from '../users';
import { UserDatabase } from '../database';
import { SyncService } from './service';
@Catch()
class SyncErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const code = error instanceof DomainError ? error.code : undefined;
    const sql = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : code === 'REFERENCE_NOT_FOUND' || code === 'CURSOR_FORBIDDEN'
          ? 403
          : code?.endsWith('_CONFLICT') || sql === '23505'
            ? 409
            : code || sql === '23514' || sql === '23503'
              ? 422
              : 500;
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(status)
      .send({
        status:
          status === 409
            ? 'conflict'
            : status === 422
              ? 'invalid'
              : status === 401
                ? 'unauthorized'
                : status === 403
                  ? 'forbidden'
                  : 'unavailable',
        error: code ?? (status === 409 ? 'ENTITY_CONFLICT' : 'REQUEST_FAILED'),
      });
  }
}
@ApiTags('Sync')
@ApiBearerAuth()
@UseFilters(SyncErrors)
@ApiResponse({ status: 401, description: 'Sesión ausente o revocada' })
@ApiResponse({ status: 403, description: 'Referencia o cursor ajeno' })
@ApiResponse({ status: 409, description: 'ID reutilizado con contenido diferente' })
@ApiResponse({
  status: 422,
  description: 'Comando o cursor inválido; no reintentar automáticamente',
})
@Controller('v1/sync')
export class SyncController {
  constructor(
    @Inject(IDENTITY) readonly identity: IdentityVerifier,
    @Inject(DATABASE) readonly database: UserDatabase | null,
  ) {}
  async context(token: string | undefined) {
    const userId = await this.identity.verify(token);
    if (!this.database) throw new ServiceUnavailableException();
    return { userId, service: new SyncService(this.database) };
  }
  @Post('commands')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirma un comando manual P08, exactamente una vez por operationId' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'operationId',
        'deviceId',
        'movementId',
        'schemaVersion',
        'baseVersion',
        'payload',
      ],
      properties: {
        operationId: { type: 'string', format: 'uuid' },
        deviceId: { type: 'string', format: 'uuid' },
        movementId: { type: 'string', format: 'uuid' },
        schemaVersion: { type: 'integer', enum: [1] },
        baseVersion: { type: 'string', enum: ['0'] },
        payload: {
          type: 'object',
          additionalProperties: false,
          required: [
            'kind',
            'accountId',
            'categoryId',
            'currency',
            'amountMinor',
            'businessDate',
            'timezone',
          ],
          properties: {
            kind: { type: 'string', enum: ['expense', 'income'] },
            accountId: { type: 'string', format: 'uuid' },
            categoryId: { type: 'string', format: 'uuid' },
            currency: { type: 'string', enum: ['PEN', 'USD'] },
            amountMinor: { type: 'string', pattern: '^[1-9][0-9]*$' },
            businessDate: { type: 'string', format: 'date' },
            timezone: { type: 'string' },
            occurredAt: { type: 'string', format: 'date-time' },
            note: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
  })
  async commands(@Headers('authorization') token: string | undefined, @Body() body: unknown) {
    const c = await this.context(token);
    return c.service.execute(c.userId, body);
  }
  @Get('changes')
  @ApiOperation({ summary: 'Cambios privados, ordenados por secuencia durable de usuario' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: String })
  async changes(@Headers('authorization') token: string | undefined, @Query() query: unknown) {
    const c = await this.context(token);
    return c.service.changes(c.userId, query);
  }
}
