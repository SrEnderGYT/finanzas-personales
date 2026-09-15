import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  Controller,
  Get,
  Module,
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { denyIdentity, type IdentityVerifier } from './auth';
import { type UserDatabase } from './database';
import { DATABASE, IDENTITY, UserController } from './users';
import { SessionController, SESSIONS } from './session-controller';
import { type SessionAuthority } from './sessions';
import { EmailController, EMAIL_AUTH } from './email-controller';
import { type EmailAuth } from './email-auth';
import { GoogleController, GOOGLE_AUTH, NATIVE_GOOGLE_AUTH } from './google-controller';
import { registerNativeCors } from './native-cors';
import { registerCatalogCors } from './catalog-cors';
import { registerWebCors } from './web-cors';
import { SyncController } from './sync/controller';
import { type GoogleAuth } from './google-auth';
import { MfaController, MFA_LOGIN } from './mfa-controller';
import { AccountsController, CategoriesController } from './catalog/controller';
import { type MfaLogin } from './mfa-login';
import { GMAIL_CONNECTION, GmailController, type GmailConnectionService } from './gmail-controller';

@Controller()
class HealthController {
  @Get('health') health() {
    return { status: 'ok', environment: 'development', financialData: false };
  }
  @Get('v1') version() {
    return { version: '1', stage: 'P17-real-app', financialCore: true };
  }
}
@Catch()
class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    reply.status(status).send({
      error:
        status === 401
          ? 'unauthorized'
          : status === 400
            ? 'invalid_request'
            : status === 404
              ? 'not_found'
              : 'request_failed',
      requestId: request.id,
    });
  }
}
export interface AppOptions {
  nativeAuthCors?: boolean;
  webCorsOrigins?: readonly string[];
  identity?: IdentityVerifier;
  database?: UserDatabase;
  sessions?: SessionAuthority;
  emailAuth?: EmailAuth;
  googleAuth?: GoogleAuth;
  nativeGoogleAuth?: GoogleAuth;
  mfaLogin?: MfaLogin;
  gmail?: GmailConnectionService;
  log?: (event: { requestId: string; method: string; status: number }) => void;
}
export async function createApp(options: AppOptions = {}) {
  @Module({
    controllers: [
      HealthController,
      UserController,
      SessionController,
      EmailController,
      GoogleController,
      MfaController,
      AccountsController,
      CategoriesController,
      SyncController,
      GmailController,
    ],
    providers: [
      { provide: IDENTITY, useValue: options.identity ?? denyIdentity },
      { provide: DATABASE, useValue: options.database ?? null },
      { provide: SESSIONS, useValue: options.sessions ?? null },
      { provide: EMAIL_AUTH, useValue: options.emailAuth ?? null },
      { provide: GOOGLE_AUTH, useValue: options.googleAuth ?? null },
      { provide: NATIVE_GOOGLE_AUTH, useValue: options.nativeGoogleAuth ?? null },
      { provide: MFA_LOGIN, useValue: options.mfaLogin ?? null },
      { provide: GMAIL_CONNECTION, useValue: options.gmail ?? null },
    ],
  })
  class AppModule {}
  const adapter = new FastifyAdapter({
    logger: false,
    bodyLimit: 16_384,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });
  adapter.getInstance().addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  });
  if (options.nativeAuthCors) registerNativeCors(adapter.getInstance());
  if (options.nativeAuthCors) registerCatalogCors(adapter.getInstance());
  registerWebCors(adapter.getInstance(), options.webCorsOrigins ?? []);
  adapter.getInstance().addHook('onResponse', async (request, reply) => {
    options.log?.({ requestId: request.id, method: request.method, status: reply.statusCode });
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  });
  app.useGlobalFilters(new SafeErrors());
  const spec = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Finanzas API').setVersion('1.0').addBearerAuth().build(),
  );
  adapter.getInstance().get('/openapi.json', async () => spec);
  await app.init();
  await adapter.getInstance().ready();
  return app;
}
