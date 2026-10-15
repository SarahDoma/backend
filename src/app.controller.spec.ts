import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('industries', () => {
    it('returns all supported industry enum values', () => {
      expect(appController.getIndustries()).toEqual([
        'CONCERTS',
        'FLIGHTS',
        'SPORTS',
        'FESTIVALS',
        'CONFERENCES',
        'BUS',
        'MOVIE_THEATERS',
        'MUSEUMS',
        'TOURIST_ATTRACTIONS',
        'PUBLIC_TRANSPORT',
        'UNIVERSITIES',
        'CORPORATE_EVENTS',
      ]);
    });
  });

  describe('health', () => {
    it('reports ok status', () => {
      expect(appController.getHealth()).toEqual({
        status: 'ok',
        service: 'stellar-tickets-backend',
      });
    });
  });
});
