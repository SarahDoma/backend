import {
  CallHandler,
  ExecutionContext,
  GatewayTimeoutException,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import {
  Observable,
  TimeoutError,
  catchError,
  throwError,
  timeout,
} from 'rxjs';

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class RequestTimeoutInterceptor implements NestInterceptor {
  constructor(
    @Optional()
    private readonly timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((error: unknown) =>
        error instanceof TimeoutError
          ? throwError(
              () => new GatewayTimeoutException('Request processing timed out'),
            )
          : throwError(() => error),
      ),
    );
  }
}
