import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { type IdentityVerifier } from './auth';
import { IDENTITY } from './users';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly' as const;

export interface GmailConnectionSnapshot {
  state: 'disconnected' | 'connected' | 'reauthorization_required';
  email?: string;
  scope: typeof GMAIL_READONLY_SCOPE;
  rangeDays: number;
  lastSyncAt?: string;
  coverageFrom?: string;
  coverageTo?: string;
}

export interface GmailOAuthStart {
  authorizationUrl: string;
}

export interface GmailConnectionService {
  connection(userId: string): Promise<unknown>;
  start(userId: string, rangeDays: number): Promise<unknown>;
  sync(userId: string): Promise<void>;
  disconnect(userId: string): Promise<void>;
  complete?(state: string, code: string): Promise<string>;
  candidates?(userId: string, status?: string): Promise<unknown[]>;
  review?(userId: string, candidateId: string, status: 'confirmed' | 'discarded'): Promise<void>;
}

export const GMAIL_CONNECTION = Symbol('GMAIL_CONNECTION');

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ServiceUnavailableException();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new ServiceUnavailableException();
}

function rangeDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 365)
    throw new BadRequestException();
  return value;
}

function optionalInstant(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new ServiceUnavailableException();
  return value;
}

function coverageDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new ServiceUnavailableException();
  return value;
}

function normalizeConnection(value: unknown): GmailConnectionSnapshot {
  const input = record(value);
  exactKeys(input, [
    'state',
    'email',
    'scope',
    'rangeDays',
    'lastSyncAt',
    'coverageFrom',
    'coverageTo',
  ]);
  if (
    input['state'] !== 'disconnected' &&
    input['state'] !== 'connected' &&
    input['state'] !== 'reauthorization_required'
  )
    throw new ServiceUnavailableException();
  if (input['scope'] !== GMAIL_READONLY_SCOPE) throw new ServiceUnavailableException();
  const selectedRange = rangeDays(input['rangeDays']);
  const lastSyncAt = optionalInstant(input['lastSyncAt']);
  const coverageFrom = coverageDate(input['coverageFrom']);
  const coverageTo = coverageDate(input['coverageTo']);
  if ((coverageFrom && !coverageTo) || (!coverageFrom && coverageTo))
    throw new ServiceUnavailableException();
  if (coverageFrom && coverageTo && coverageFrom > coverageTo)
    throw new ServiceUnavailableException();
  if (input['state'] === 'connected') {
    if (
      typeof input['email'] !== 'string' ||
      input['email'].length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input['email'])
    )
      throw new ServiceUnavailableException();
  } else if (input['email'] !== undefined && typeof input['email'] !== 'string') {
    throw new ServiceUnavailableException();
  }
  return {
    state: input['state'],
    scope: GMAIL_READONLY_SCOPE,
    rangeDays: selectedRange,
    ...(typeof input['email'] === 'string' ? { email: input['email'] } : {}),
    ...(lastSyncAt ? { lastSyncAt } : {}),
    ...(coverageFrom ? { coverageFrom } : {}),
    ...(coverageTo ? { coverageTo } : {}),
  };
}

function normalizeStart(value: unknown): GmailOAuthStart {
  const input = record(value);
  exactKeys(input, ['authorizationUrl']);
  if (typeof input['authorizationUrl'] !== 'string') throw new ServiceUnavailableException();
  let url: URL;
  try {
    url = new URL(input['authorizationUrl']);
  } catch {
    throw new ServiceUnavailableException();
  }
  if (
    url.origin !== 'https://accounts.google.com' ||
    url.pathname !== '/o/oauth2/v2/auth' ||
    url.username ||
    url.password
  )
    throw new ServiceUnavailableException();
  const scopes = new Set((url.searchParams.get('scope') ?? '').split(/\s+/).filter(Boolean));
  if (!scopes.has(GMAIL_READONLY_SCOPE)) throw new ServiceUnavailableException();
  return { authorizationUrl: url.href };
}

function startInput(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'rangeDays'))
    throw new BadRequestException();
  return rangeDays(input['rangeDays']);
}

function candidateStatus(value: unknown) {
  if (value === undefined) return 'pending';
  if (value !== 'pending' && value !== 'confirmed' && value !== 'discarded' && value !== 'all')
    throw new BadRequestException();
  return value;
}

@ApiTags('Gmail')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Sesión ausente, inválida o revocada' })
@ApiResponse({ status: 503, description: 'Gmail no configurado en este entorno' })
@Controller('v1/gmail')
export class GmailController {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityVerifier,
    @Inject(GMAIL_CONNECTION) private readonly gmail: GmailConnectionService | null,
  ) {}

  private service() {
    if (!this.gmail) throw new ServiceUnavailableException();
    return this.gmail;
  }

  private user(token: string | undefined) {
    return this.identity.verify(token);
  }

  @Get('connection')
  @ApiOperation({ summary: 'Estado de la conexión Gmail del usuario actual, sin secretos' })
  async connection(
    @Headers('authorization') token: string | undefined,
  ): Promise<GmailConnectionSnapshot> {
    const userId = await this.user(token);
    return normalizeConnection(await this.service().connection(userId));
  }

  @Post('oauth/start')
  @ApiOperation({ summary: 'Inicia consentimiento Gmail readonly para el usuario actual' })
  async start(
    @Headers('authorization') token: string | undefined,
    @Body() body: unknown,
  ): Promise<GmailOAuthStart> {
    const userId = await this.user(token);
    return normalizeStart(await this.service().start(userId, startInput(body)));
  }

  @Get('oauth/callback')
  @ApiOperation({ summary: 'Completa el consentimiento Gmail y vuelve a la aplicación' })
  async callback(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const service = this.service();
    if (error || !state || !code || !service.complete) throw new BadRequestException();
    const destination = await service.complete(state, code);
    let url: URL;
    try {
      url = new URL(destination);
    } catch {
      throw new ServiceUnavailableException();
    }
    if (url.protocol !== 'https:' || url.username || url.password) throw new ServiceUnavailableException();
    return reply.code(303).header('Location', url.href).send();
  }

  @Post('sync')
  @HttpCode(202)
  @ApiOperation({ summary: 'Sincroniza mensajes y detecciones financieras de Gmail' })
  async sync(@Headers('authorization') token: string | undefined) {
    const userId = await this.user(token);
    await this.service().sync(userId);
    return { status: 'accepted' as const };
  }

  @Get('candidates')
  @ApiOperation({ summary: 'Lista hallazgos financieros detectados en Gmail' })
  async candidates(
    @Headers('authorization') token: string | undefined,
    @Query('status') status: string | undefined,
  ) {
    const userId = await this.user(token);
    const service = this.service();
    if (!service.candidates) throw new ServiceUnavailableException();
    return { items: await service.candidates(userId, candidateStatus(status)) };
  }

  @Post('candidates/:id/confirm')
  @HttpCode(204)
  async confirm(
    @Headers('authorization') token: string | undefined,
    @Param('id') id: string,
  ) {
    const userId = await this.user(token);
    const service = this.service();
    if (!service.review) throw new ServiceUnavailableException();
    await service.review(userId, id, 'confirmed');
  }

  @Post('candidates/:id/discard')
  @HttpCode(204)
  async discard(
    @Headers('authorization') token: string | undefined,
    @Param('id') id: string,
  ) {
    const userId = await this.user(token);
    const service = this.service();
    if (!service.review) throw new ServiceUnavailableException();
    await service.review(userId, id, 'discarded');
  }

  @Delete('connection')
  @HttpCode(204)
  @ApiOperation({ summary: 'Desconecta Gmail y detiene nuevas lecturas' })
  async disconnect(@Headers('authorization') token: string | undefined) {
    const userId = await this.user(token);
    await this.service().disconnect(userId);
  }
}
