import {
  BadRequestException,
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
export const NATIVE_GOOGLE_AUTH = Symbol('native-google-auth');

type GoogleMode = 'login' | 'link' | 'reauthenticate';

function webPkceStart(value: unknown): {
  mode: GoogleMode;
  proof: { state: unknown; challenge: unknown; method: unknown };
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  const input = value as Record<string, unknown>;
  const keys = ['mode', 'state', 'challenge', 'method'];
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key)))
    throw new BadRequestException();
  const mode = input['mode'];
  if (mode !== 'login' && mode !== 'link' && mode !== 'reauthenticate')
    throw new BadRequestException();
  return {
    mode,
    proof: {
      state: input['state'],
      challenge: input['challenge'],
      method: input['method'],
    },
  };
}

@ApiTags('Google authentication')
@Controller('v1/auth/google')
export class GoogleController {
  constructor(
    @Inject(GOOGLE_AUTH) private readonly auth: GoogleAuth | null,
    @Inject(NATIVE_GOOGLE_AUTH) private readonly nativeAuth: GoogleAuth | null,
  ) {}
  @Post('native/start')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'challenge', 'method'],
      properties: {
        state: { type: 'string' },
        challenge: { type: 'string' },
        method: { type: 'string', enum: ['S256'] },
      },
    },
  })
  startNative(@Body() body: unknown, @Req() request: FastifyRequest) {
    if (!this.nativeAuth) throw new ServiceUnavailableException();
    return this.nativeAuth.startNative(body, request.ip);
  }
  @Post('native/complete')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'code', 'verifier'],
      properties: {
        state: { type: 'string' },
        code: { type: 'string' },
        verifier: { type: 'string' },
      },
    },
  })
  completeNative(@Body() body: unknown, @Req() request: FastifyRequest) {
    if (!this.nativeAuth) throw new ServiceUnavailableException();
    return this.nativeAuth.completeNative(body, request.ip);
  }
  @Post('native/reauthenticate')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'challenge', 'method'],
      properties: {
        state: { type: 'string' },
        challenge: { type: 'string' },
        method: { type: 'string', enum: ['S256'] },
      },
    },
  })
  reauthenticateNative(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    if (!this.nativeAuth) throw new ServiceUnavailableException();
    return this.nativeAuth.startNative(body, request.ip, { authorization, mode: 'reauthenticate' });
  }
  @Post('native/link')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'challenge', 'method'],
      properties: {
        state: { type: 'string' },
        challenge: { type: 'string' },
        method: { type: 'string', enum: ['S256'] },
      },
    },
  })
  linkNative(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    if (!this.nativeAuth) throw new ServiceUnavailableException();
    return this.nativeAuth.startNative(body, request.ip, { authorization, mode: 'link' });
  }
  private service() {
    if (!this.auth) throw new ServiceUnavailableException();
    return this.auth;
  }
  @Post('pkce/start')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'state', 'challenge', 'method'],
      properties: {
        mode: { type: 'string', enum: ['login', 'link', 'reauthenticate'] },
        state: { type: 'string' },
        challenge: { type: 'string' },
        method: { type: 'string', enum: ['S256'] },
      },
    },
  })
  startWebPkce(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const { mode, proof } = webPkceStart(body);
    return this.service().startNative(
      proof,
      request.ip,
      mode === 'login' ? undefined : { authorization, mode },
    );
  }
  @Post('pkce/complete')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'code', 'verifier'],
      properties: {
        state: { type: 'string' },
        code: { type: 'string' },
        verifier: { type: 'string' },
      },
    },
  })
  completeWebPkce(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service().completeNative(body, request.ip);
  }
  @Post('start')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: { mode: { type: 'string', enum: ['login', 'link', 'reauthenticate'] } },
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
