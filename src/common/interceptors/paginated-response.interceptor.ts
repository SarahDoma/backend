import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { paginate, type Paginated } from '../pagination/paginated';

/**
 * Wraps a handler's `[items, total]` result (the shape of
 * `prisma.$transaction([findMany, count])`) into a {@link Paginated}
 * body, reading `page` / `limit` from the request query with the same
 * defaults as {@link PaginationQueryDto}. The handler's own
 * `@Query() PaginationQueryDto` has already been validated by the global
 * ValidationPipe, so the values here are known to be in range.
 */
@Injectable()
export class PaginatedResponseInterceptor<T> implements NestInterceptor<
  [T[], number],
  Paginated<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<[T[], number]>,
  ): Observable<Paginated<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const query = plainToInstance(PaginationQueryDto, request.query ?? {});

    return next.handle().pipe(
      map((result) => {
        if (
          !Array.isArray(result) ||
          result.length !== 2 ||
          !Array.isArray(result[0]) ||
          typeof result[1] !== 'number'
        ) {
          throw new Error(
            'PaginatedResponseInterceptor expects the handler to return [items, total]',
          );
        }
        const [items, total] = result;
        return paginate(items, total, query);
      }),
    );
  }
}
