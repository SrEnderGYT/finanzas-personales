import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Patch,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { type IdentityVerifier } from './auth';
import { UserDatabase } from './database';
export const IDENTITY = Symbol('identity');
export const DATABASE = Symbol('database');
export type Theme = 'light' | 'dark' | 'system';
export function validatePreferences(body: unknown): { theme: Theme } {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new BadRequestException();
  const object = body as Record<string, unknown>;
  if (
    Object.keys(object).length !== 1 ||
    typeof object['theme'] !== 'string' ||
    !['light', 'dark', 'system'].includes(object['theme'])
  )
    throw new BadRequestException();
  return { theme: object['theme'] as Theme };
}
@ApiTags('User')
@ApiBearerAuth()
@Controller('v1/me')
export class UserController {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityVerifier,
    @Inject(DATABASE) private readonly database: UserDatabase | null,
  ) {}
  @Get()
  @ApiOperation({ summary: 'Perfil del usuario autenticado; nunca permite elegir otro usuario' })
  @ApiResponse({ status: 401, description: 'Credencial ausente o inválida' })
  async get(@Headers('authorization') authorization: string | undefined) {
    const id = await this.identity.verify(authorization);
    if (!this.database) throw new ServiceUnavailableException();
    return this.database.asUser(id, async (client) => {
      const result = await client.query<{ id: string; theme: Theme; locale: string }>(
        `
        SELECT u.id, coalesce(p.theme, 'system') AS theme, coalesce(p.locale, 'es-PE') AS locale
        FROM app.users u LEFT JOIN app.user_preferences p ON p.user_id=u.id WHERE u.id=$1`,
        [id],
      );
      if (!result.rows[0]) throw new NotFoundException();
      return result.rows[0];
    });
  }
  @Patch('preferences')
  @ApiOperation({ summary: 'Actualiza únicamente las preferencias del usuario autenticado' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['theme'],
      additionalProperties: false,
      properties: { theme: { type: 'string', enum: ['light', 'dark', 'system'] } },
    },
  })
  async update(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const id = await this.identity.verify(authorization);
    const { theme } = validatePreferences(body);
    if (!this.database) throw new ServiceUnavailableException();
    return this.database.asUser(id, async (client) => {
      if (!(await client.query('SELECT id FROM app.users WHERE id=$1', [id])).rowCount)
        throw new NotFoundException();
      const result = await client.query<{ theme: Theme; locale: string }>(
        `
        INSERT INTO app.user_preferences (user_id, theme) VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET theme=excluded.theme, updated_at=now()
        RETURNING theme, locale`,
        [id, theme],
      );
      return result.rows[0];
    });
  }
}
