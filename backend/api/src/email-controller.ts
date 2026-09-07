import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { type FastifyRequest } from 'fastify';
import { EmailAuth } from './email-auth';
export const EMAIL_AUTH = Symbol('email-auth');
const schema = (fields: string[]) => ({
  schema: {
    type: 'object',
    additionalProperties: false,
    required: fields,
    properties: Object.fromEntries(
      fields.map((field) => [
        field,
        { type: 'string', ...(field === 'password' ? { minLength: 15, maxLength: 128 } : {}) },
      ]),
    ),
  },
});
@ApiTags('Email authentication')
@Controller('v1/auth')
export class EmailController {
  constructor(@Inject(EMAIL_AUTH) private readonly auth: EmailAuth | null) {}
  private service() {
    if (!this.auth) throw new ServiceUnavailableException();
    return this.auth;
  }
  @Post('register')
  @HttpCode(202)
  @ApiBody(schema(['email']))
  register(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service().request(body, request.ip, 'verify');
  }
  @Post('verify-email')
  @HttpCode(200)
  @ApiBody(schema(['token', 'password']))
  verify(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service().complete(body, request.ip, 'verify');
  }
  @Post('forgot-password')
  @HttpCode(202)
  @ApiBody(schema(['email']))
  forgot(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service().request(body, request.ip, 'reset');
  }
  @Post('reset-password')
  @HttpCode(200)
  @ApiBody(schema(['token', 'password']))
  reset(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service().complete(body, request.ip, 'reset');
  }
  @Post('login')
  @HttpCode(200)
  @ApiBody(schema(['email', 'password']))
  login(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service().login(body, request.ip);
  }
}
