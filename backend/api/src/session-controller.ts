import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionAuthority } from './sessions';
export const SESSIONS = Symbol('sessions');
@ApiTags('Sessions')
@ApiBearerAuth()
@Controller('v1/auth')
export class SessionController {
  constructor(@Inject(SESSIONS) private readonly sessions: SessionAuthority | null) {}
  private authority() {
    if (!this.sessions) throw new ServiceUnavailableException();
    return this.sessions;
  }
  @Post('session')
  @ApiOperation({
    summary: 'Canjea una prueba de login validada una sola vez por una sesión revocable',
  })
  issue(@Headers('authorization') token: string | undefined) {
    return this.authority().issue(token);
  }
  @Get('sessions')
  list(@Headers('authorization') token: string | undefined) {
    return this.authority().list(token);
  }
  @Delete('sessions/:id')
  @HttpCode(204)
  revoke(@Headers('authorization') token: string | undefined, @Param('id') id: string) {
    return this.authority().revoke(token, id);
  }
  @Post('logout')
  @HttpCode(204)
  logout(@Headers('authorization') token: string | undefined) {
    return this.authority().logout(token);
  }
  @Delete('sessions')
  @HttpCode(204)
  revokeAll(@Headers('authorization') token: string | undefined) {
    return this.authority().logout(token, true);
  }
}
