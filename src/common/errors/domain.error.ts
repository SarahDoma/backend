export abstract class DomainError extends Error {
  protected constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ListingInactiveError extends DomainError {
  constructor() {
    super('LISTING_INACTIVE', 'This ticket is not listed for resale');
  }
}

export class TicketTypeSoldOutError extends DomainError {
  constructor() {
    super('TICKET_TYPE_SOLD_OUT', 'This ticket type is sold out');
  }
}
