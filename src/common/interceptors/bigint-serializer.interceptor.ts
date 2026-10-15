import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const bigIntPrototype = BigInt.prototype as { toJSON?: () => string };
if (!bigIntPrototype.toJSON) {
  bigIntPrototype.toJSON = function (this: bigint) {
    return this.toString();
  };
}

/**
 * Serializes BigInt values to strings in JSON responses.
 * Handles nested objects, arrays, and arbitrary deep structures.
 */
@Injectable()
export class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(map((data: unknown) => this.serializeBigInts(data)));
  }

  private serializeBigInts(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (value instanceof Date) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeBigInts(item));
    }

    if (typeof value === 'object') {
      const converted: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        converted[key] = this.serializeBigInts(nested);
      }
      return converted;
    }

    return value;
  }
}
