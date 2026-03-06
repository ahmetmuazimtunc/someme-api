import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Attaches user to request if a valid JWT is present, but does NOT reject
 * unauthenticated requests. Use on endpoints that work for both guests and users.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<T>(_err: unknown, user: T): T {
    return user;
  }
}
