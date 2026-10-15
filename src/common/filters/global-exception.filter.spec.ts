import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from './global-exception.filter';
import {
  ListingInactiveError,
  TicketTypeSoldOutError,
} from '../errors/domain.error';

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  function host() {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      method: 'GET',
      url: '/test',
    };
    const argumentsHost = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
    return { argumentsHost, response };
  }

  function createPrismaError(
    code: string,
    meta?: Record<string, unknown>,
  ): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Test error', {
      code,
      clientVersion: '5.0.0',
      meta,
    });
  }

  describe('HTTP exceptions', () => {
    it('forwards a NotFoundException with its status and Nest body shape', () => {
      const { argumentsHost, response } = host();
      filter.catch(new NotFoundException('Ticket not found'), argumentsHost);
      expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Ticket not found',
        error: 'Not Found',
      });
    });

    it('keeps ValidationPipe-style message arrays intact', () => {
      const { argumentsHost, response } = host();
      filter.catch(
        new BadRequestException([
          'price must be a non-negative integer string',
        ]),
        argumentsHost,
      );
      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_REQUEST,
        message: ['price must be a non-negative integer string'],
        error: 'Bad Request',
      });
    });

    it('wraps a bare string response body', () => {
      const { argumentsHost, response } = host();
      filter.catch(
        new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS),
        argumentsHost,
      );
      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'slow down',
      });
    });
  });

  describe('Prisma errors', () => {
    it('maps P2002 to 409 Conflict', () => {
      const { argumentsHost, response } = host();

      filter.catch(createPrismaError('P2002'), argumentsHost);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.CONFLICT,
        code: 'PRISMA_P2002',
        message: 'A record with this value already exists',
      });
    });

    it('maps P2025 to 404 Not Found', () => {
      const { argumentsHost, response } = host();

      filter.catch(createPrismaError('P2025'), argumentsHost);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.NOT_FOUND,
        code: 'PRISMA_P2025',
        message: 'Record not found',
      });
    });

    it('maps unknown Prisma codes to 500', () => {
      const { argumentsHost, response } = host();

      filter.catch(createPrismaError('P2003'), argumentsHost);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'PRISMA_P2003',
        message: 'Database operation failed',
      });
    });

    it('maps Prisma validation error to 400', () => {
      const { argumentsHost, response } = host();

      const error = new Prisma.PrismaClientValidationError('Invalid', {
        clientVersion: '5.0.0',
      });
      filter.catch(error, argumentsHost);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'PRISMA_VALIDATION_ERROR',
        message: 'Invalid data provided',
      });
    });

    it('maps Prisma initialization error to 503', () => {
      const { argumentsHost, response } = host();

      filter.catch(
        new Prisma.PrismaClientInitializationError(
          'Connection failed',
          '5.0.0',
        ),
        argumentsHost,
      );

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'PRISMA_INITIALIZATION_ERROR',
        message: 'Database connection failed',
      });
    });
  });

  describe('Domain errors', () => {
    it('maps LISTING_INACTIVE to 400', () => {
      const { argumentsHost, response } = host();

      filter.catch(new ListingInactiveError(), argumentsHost);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'LISTING_INACTIVE',
        message: 'This ticket is not listed for resale',
      });
    });

    it('maps TICKET_TYPE_SOLD_OUT to 409', () => {
      const { argumentsHost, response } = host();

      filter.catch(new TicketTypeSoldOutError(), argumentsHost);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.CONFLICT,
        code: 'TICKET_TYPE_SOLD_OUT',
        message: 'This ticket type is sold out',
      });
    });

    it('maps unknown Error subclasses to 500 without leaking internals', () => {
      const { argumentsHost, response } = host();

      class UnknownError extends Error {
        code = 'UNKNOWN_CODE';
        message = 'Unknown error';
        constructor() {
          super('Unknown error');
          this.name = 'UnknownError';
        }
      }

      filter.catch(new UnknownError(), argumentsHost);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });
  });

  describe('Unknown errors', () => {
    it('returns 500 without leaking internals', () => {
      const { argumentsHost, response } = host();

      filter.catch(new Error('Internal secret'), argumentsHost);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });

    it('returns 500 for non-Error values', () => {
      const { argumentsHost, response } = host();

      filter.catch('string error', argumentsHost);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(response.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });
  });
});
