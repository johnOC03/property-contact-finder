import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { OpenRouterService } from './open-router.service';

describe('OpenRouterService', () => {
  let service: OpenRouterService;
  let httpService: { post: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    httpService = { post: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('test-key') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenRouterService,
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<OpenRouterService>(OpenRouterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws if OPENROUTER_API_KEY is not configured', async () => {
    configService.get.mockReturnValue(undefined);

    await expect(service.searchContactDetails('John Smith')).rejects.toThrow(
      'OPENROUTER_API_KEY is not configured',
    );
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('sends the API key only as an Authorization header to the OpenRouter endpoint', async () => {
    httpService.post.mockReturnValue(of({ data: { choices: [{ message: { content: '[]' } }] } }));

    await service.searchContactDetails('John Smith', '12 Queen Street, Auckland');

    expect(httpService.post).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ model: 'perplexity/sonar' }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('parses a well-formed JSON array response into contact leads', async () => {
    const content = JSON.stringify([
      {
        name: 'John Smith',
        email: null,
        phone: '09 123 4567',
        other: null,
        sourceUrl: 'https://www.yellow.co.nz/example',
        quote: 'John Smith, 12 Queen Street',
      },
    ]);
    httpService.post.mockReturnValue(of({ data: { choices: [{ message: { content } }] } }));

    const leads = await service.searchContactDetails('John Smith');

    expect(leads).toEqual([
      {
        name: 'John Smith',
        email: undefined,
        phone: '09 123 4567',
        other: undefined,
        sourceUrl: 'https://www.yellow.co.nz/example',
        quote: 'John Smith, 12 Queen Street',
      },
    ]);
  });

  it('strips markdown code fences before parsing', async () => {
    const content = '```json\n[{"name": "John Smith", "sourceUrl": "https://example.com"}]\n```';
    httpService.post.mockReturnValue(of({ data: { choices: [{ message: { content } }] } }));

    const leads = await service.searchContactDetails('John Smith');

    expect(leads).toHaveLength(1);
    expect(leads[0].sourceUrl).toBe('https://example.com');
  });

  it('returns an empty array when the model reports no leads', async () => {
    httpService.post.mockReturnValue(of({ data: { choices: [{ message: { content: '[]' } }] } }));

    const leads = await service.searchContactDetails('John Smith');

    expect(leads).toEqual([]);
  });

  it('returns an empty array when the response is not valid JSON', async () => {
    httpService.post.mockReturnValue(
      of({ data: { choices: [{ message: { content: 'sorry, I could not find anything' } }] } }),
    );

    const leads = await service.searchContactDetails('John Smith');

    expect(leads).toEqual([]);
  });

  it('throws a descriptive error and never logs the API key when the request fails', async () => {
    const logSpy = jest.spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn');
    httpService.post.mockReturnValue(throwError(() => new Error('Request failed with status code 401')));

    await expect(service.searchContactDetails('John Smith')).rejects.toThrow(
      'OpenRouter web search request failed: Request failed with status code 401',
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Request failed with status code 401'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('test-key'));
  });
});
