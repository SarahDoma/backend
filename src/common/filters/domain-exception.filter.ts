import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../errors/domain.error';

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  LISTING_INACTIVE: HttpStatus.BAD_REQUEST,
  TICKET_TYPE_SOLD_OUT: HttpStatus.CONFLICT,
};

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode =
      STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(statusCode).json({
      statusCode,
      code: exception.code,
      message: exception.message,
    });
  }
}
