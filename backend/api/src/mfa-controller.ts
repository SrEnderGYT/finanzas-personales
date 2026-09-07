import {
  Body,
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
  constructor(@Inject(MFA_LOGIN) private readonly login: MfaLogin | null) {}
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
}
