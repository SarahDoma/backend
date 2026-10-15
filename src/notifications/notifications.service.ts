import { Inject, Injectable, Logger } from '@nestjs/common';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

@Injectable()
export class LogEmailProvider implements EmailProvider {
  private readonly logger = new Logger(LogEmailProvider.name);
  send(message: EmailMessage): Promise<void> {
    this.logger.log(
      `Email to ${message.to}: ${message.subject}\n${message.text}`,
    );
    return Promise.resolve();
  }
}

@Injectable()
export class NotificationService {
  constructor(
    @Inject(LogEmailProvider) private readonly provider: EmailProvider,
  ) {}

  sendTicketReceipt(input: {
    to: string;
    buyerName: string;
    eventName: string;
    ticketType: string;
    seat: string;
  }): Promise<void> {
    return this.provider.send({
      to: input.to,
      subject: `Your ${input.eventName} ticket`,
      text: `Hi ${input.buyerName},\n\nYour ${input.ticketType} ticket for ${input.eventName} is confirmed.\nSeat: ${input.seat}\n`,
    });
  }
}
