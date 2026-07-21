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
        address: '12 Queen Street, Auckland',
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
        address: '12 Queen Street, Auckland',
        sourceUrl: 'https://www.yellow.co.nz/example',
        quote: 'John Smith, 12 Queen Street',
      },
    ]);
  });

  it('parses a relationshipNote field for a different connected person', async () => {
    const content = JSON.stringify([
      {
        name: 'Jane Doe',
        email: null,
        phone: null,
        other: null,
        address: '12 Queen Street, Auckland',
        relationshipNote: 'Director of Acme Ltd, registered at this address',
        sourceUrl: 'https://www.companies-office.govt.nz/example',
        quote: 'Jane Doe, director',
      },
    ]);
    httpService.post.mockReturnValue(of({ data: { choices: [{ message: { content } }] } }));

    const leads = await service.searchContactDetails('John Smith', '12 Queen Street, Auckland');

    expect(leads[0].relationshipNote).toBe('Director of Acme Ltd, registered at this address');
  });

  it('uses a property-connection prompt (mentions the address and alternative connections) when an address is given', async () => {
    httpService.post.mockReturnValue(of({ data: { choices: [{ message: { content: '[]' } }] } }));

    await service.searchContactDetails('John Smith', '12 Queen Street, Auckland');

    const [, body] = httpService.post.mock.calls[0] as [string, { messages: { role: string; content: string }[] }];
    const userMessage = body.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('12 Queen Street, Auckland');
    expect(userMessage).toContain('relationshipNote');
  });

  it('uses a name-only prompt (no relationshipNote/address anchoring) when no address is given', async () => {
    httpService.post.mockReturnValue(of({ data: { choices: [{ message: { content: '[]' } }] } }));

    await service.searchContactDetails('John Smith');

    const [, body] = httpService.post.mock.calls[0] as [string, { messages: { role: string; content: string }[] }];
    const userMessage = body.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).not.toContain('relationshipNote');
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

  describe('searchContactDetailsEnsemble', () => {
    it('fires the configured number of parallel calls and unions their leads', async () => {
      httpService.post
        .mockReturnValueOnce(
          of({ data: { choices: [{ message: { content: JSON.stringify([{ name: 'John Smith', phone: '09 111 1111' }]) } }] } }),
        )
        .mockReturnValueOnce(of({ data: { choices: [{ message: { content: '[]' } }] } }))
        .mockReturnValueOnce(
          of({ data: { choices: [{ message: { content: JSON.stringify([{ name: 'Jane Doe', email: 'jane@example.com' }]) } }] } }),
        );

      const leads = await service.searchContactDetailsEnsemble('John Smith', undefined, 3);

      expect(httpService.post).toHaveBeenCalledTimes(3);
      expect(leads).toEqual([
        expect.objectContaining({ name: 'John Smith', phone: '09 111 1111' }),
        expect.objectContaining({ name: 'Jane Doe', email: 'jane@example.com' }),
      ]);
    });

    it('deduplicates identical leads repeated across runs', async () => {
      const sameLead = JSON.stringify([{ name: 'John Smith', phone: '09 111 1111', sourceUrl: 'https://yellow.co.nz/x' }]);
      httpService.post
        .mockReturnValueOnce(of({ data: { choices: [{ message: { content: sameLead } }] } }))
        .mockReturnValueOnce(of({ data: { choices: [{ message: { content: sameLead } }] } }))
        .mockReturnValueOnce(of({ data: { choices: [{ message: { content: sameLead } }] } }));

      const leads = await service.searchContactDetailsEnsemble('John Smith', undefined, 3);

      expect(leads).toHaveLength(1);
    });

    it('tolerates some calls failing as long as at least one succeeds', async () => {
      httpService.post
        .mockReturnValueOnce(of({ data: { choices: [{ message: { content: JSON.stringify([{ name: 'John Smith' }]) } }] } }))
        .mockReturnValueOnce(throwError(() => new Error('timeout')))
        .mockReturnValueOnce(throwError(() => new Error('timeout')));

      const leads = await service.searchContactDetailsEnsemble('John Smith', undefined, 3);

      expect(leads).toEqual([expect.objectContaining({ name: 'John Smith' })]);
    });

    it('rethrows when every call in the ensemble fails', async () => {
      httpService.post.mockReturnValue(throwError(() => new Error('Request failed with status code 401')));

      await expect(service.searchContactDetailsEnsemble('John Smith', undefined, 3)).rejects.toThrow(
        'OpenRouter web search request failed: Request failed with status code 401',
      );
    });
  });
});
