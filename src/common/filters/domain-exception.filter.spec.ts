import { HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import {
  ListingInactiveError,
  TicketTypeSoldOutError,
} from '../errors/domain.error';
import { DomainExceptionFilter } from './domain-exception.filter';

describe('DomainExceptionFilter', () => {
  function host() {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const argumentsHost = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    return { argumentsHost, response };
  }

  it('maps an inactive listing to a stable 400 response', () => {
    const { argumentsHost, response } = host();

    new DomainExceptionFilter().catch(
      new ListingInactiveError(),
      argumentsHost,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      code: 'LISTING_INACTIVE',
      message: 'This ticket is not listed for resale',
    });
  });

  it('maps sold out inventory to conflict', () => {
    const { argumentsHost, response } = host();

    new DomainExceptionFilter().catch(
      new TicketTypeSoldOutError(),
      argumentsHost,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });
});
