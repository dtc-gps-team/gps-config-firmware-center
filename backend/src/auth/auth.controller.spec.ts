import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: { login: jest.Mock };

  beforeEach(async () => {
    service = { login: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    }).compile();

    controller = module.get(AuthController);
  });

  it('login: ส่งต่อ username/password ให้ service แล้วคืนผลตรงๆ', async () => {
    service.login.mockResolvedValue({ accessToken: 'token', role: 'SW' });

    const result = await controller.login({
      username: 'sw.test',
      password: 'password123',
    });

    expect(service.login).toHaveBeenCalledWith('sw.test', 'password123');
    expect(result).toEqual({ accessToken: 'token', role: 'SW' });
  });
});
