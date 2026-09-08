import { SESSIONS } from './session-controller';
import { SessionAuthority } from './sessions';
import {
  Body,
  Headers,
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { MfaLogin } from './mfa-login';
export const MFA_LOGIN = Symbol('mfa-login');
@ApiTags('MFA')
@Controller('v1/auth/mfa')
export class MfaController {
  constructor(
    @Inject(MFA_LOGIN) private readonly login: MfaLogin | null,
    @Inject(SESSIONS) private readonly sessions: SessionAuthority | null,
  ) {}
  private field(body: unknown, key: string): string {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as Record<string, unknown>)[key] !== 'string'
    )
      throw new BadRequestException();
    return (body as Record<string, string>)[key]!;
  }
  @Post('enrollment/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicia inscripción con permiso de reautenticación de un solo uso' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['grant'],
      properties: { grant: { type: 'string' } },
    },
  })
  async start(@Body() body: unknown, @Headers('authorization') authorization: string | undefined) {
    if (!this.login || !this.sessions) throw new ServiceUnavailableException();
    const current = await this.sessions.resolve(authorization);
    return this.login.beginEnrollment(
      current.user_id,
      current.session_id,
      this.field(body, 'grant'),
    );
  }
  @Post('enrollment/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirma posesión y devuelve códigos de recuperación una sola vez' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['code'],
      properties: { code: { type: 'string', pattern: '^[0-9]{6}$' } },
    },
  })
  async confirm(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    if (!this.login || !this.sessions) throw new ServiceUnavailableException();
    const current = await this.sessions.resolve(authorization);
    return this.login.confirmEnrollment(
      current.user_id,
      current.session_id,
      this.field(body, 'code'),
    );
  }
  @Post('complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Completa el segundo factor antes de emitir una sesión' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['challenge', 'code'],
      properties: { challenge: { type: 'string' }, code: { type: 'string', pattern: '^\\d{6}$' } },
    },
  })
  complete(@Body() body: unknown, @Req() request: FastifyRequest) {
    if (!this.login) throw new ServiceUnavailableException();
    return this.login.complete(body, request.ip);
  }
  @Post('recover')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Canjea un código de recuperación tras verificar la identidad primaria',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['challenge', 'code'],
      properties: {
        challenge: { type: 'string' },
        code: { type: 'string', pattern: '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{8}){3}$' },
      },
    },
  })
  recover(@Body() body: unknown, @Req() request: FastifyRequest) {
    if (!this.login) throw new ServiceUnavailableException();
    return this.login.complete(body, request.ip, true);
  }
}
