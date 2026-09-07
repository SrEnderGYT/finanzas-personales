import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { GoogleAuth, GOOGLE_COOKIE } from './google-auth';
export const GOOGLE_AUTH = Symbol('google-auth');
@ApiTags('Google authentication')
@Controller('v1/auth/google')
export class GoogleController {
  constructor(@Inject(GOOGLE_AUTH) private readonly auth: GoogleAuth | null) {}
  private service() {
    if (!this.auth) throw new ServiceUnavailableException();
    return this.auth;
  }
  @Post('start')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: { mode: { type: 'string', enum: ['login', 'link'] } },
    },
  })
  async start(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.service().start(
      body,
      authorization,
      request.headers.origin,
      request.ip,
    );
    reply.header(
      'Set-Cookie',
      `${GOOGLE_COOKIE}=${result.binding}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    );
    return { authorizationUrl: result.authorizationUrl };
  }
  @Post('complete')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'code'],
      properties: { state: { type: 'string' }, code: { type: 'string' } },
    },
  })
  async complete(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.service().complete(
      body,
      request.headers.cookie,
      request.headers.origin,
      request.ip,
    );
    reply.header(
      'Set-Cookie',
      `${GOOGLE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    );
    return result;
  }
}
