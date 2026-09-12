import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { type IdentityVerifier } from './auth';
import { IDENTITY } from './users';
import {
  gmailRangeDays,
  normalizeGmailConnection,
  normalizeGmailOAuthStart,
  type GmailConnectionSnapshot,
  type GmailOAuthStart,
} from '../../../packages/shared/src/gmail-connection';

export interface GmailConnectionService {
  connection(userId: string): Promise<unknown>;
  start(userId: string, rangeDays: number): Promise<unknown>;
  sync(userId: string): Promise<void>;
  disconnect(userId: string): Promise<void>;
}

export const GMAIL_CONNECTION = Symbol('GMAIL_CONNECTION');

function startInput(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'rangeDays'))
    throw new BadRequestException();
  try {
    return gmailRangeDays(input['rangeDays']);
  } catch {
    throw new BadRequestException();
  }
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
    return normalizeGmailConnection(await this.service().connection(userId));
  }

  @Post('oauth/start')
  @ApiOperation({ summary: 'Inicia consentimiento Gmail readonly para el usuario actual' })
  async start(
    @Headers('authorization') token: string | undefined,
    @Body() body: unknown,
  ): Promise<GmailOAuthStart> {
    const userId = await this.user(token);
    return normalizeGmailOAuthStart(await this.service().start(userId, startInput(body)));
  }

  @Post('sync')
  @HttpCode(202)
  @ApiOperation({ summary: 'Solicita sincronización de la conexión Gmail vigente' })
  async sync(@Headers('authorization') token: string | undefined) {
    const userId = await this.user(token);
    await this.service().sync(userId);
    return { status: 'accepted' as const };
  }

  @Delete('connection')
  @HttpCode(204)
  @ApiOperation({ summary: 'Desconecta Gmail y detiene nuevas lecturas' })
  async disconnect(@Headers('authorization') token: string | undefined) {
    const userId = await this.user(token);
    await this.service().disconnect(userId);
  }
}
