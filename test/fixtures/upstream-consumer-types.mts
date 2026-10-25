import { listFunction, listFunctions, listFunctionsFiles, zipFunction, zipFunctions, type FunctionConfig } from '@netlify/zip-it-and-ship-it';
import { functionConfigShape } from '@netlify/zip-it-and-ship-it/dist/config.js';
import { inSourceConfig, type InSourceConfig } from '@netlify/zip-it-and-ship-it/dist/runtimes/node/in_source_config/index.js';
import { getTrafficRulesConfig } from '@netlify/zip-it-and-ship-it/dist/rate_limit.js';
type HttpMethod = NonNullable<InSourceConfig['method']>[number];
const method: HttpMethod = 'GET';
const methods: HttpMethod[] = [method, 'POST'];
const config: FunctionConfig = { nodeBundler: 'esbuild', nodeModuleFormat: 'esm', memory: 2048 };
functionConfigShape.parse(config);
inSourceConfig.parse({ method: methods });
getTrafficRulesConfig({ windowLimit: 10, windowSize: 60, aggregateBy: ['ip'] });
// @ts-expect-error -- invalid rate limit data must not become any.
getTrafficRulesConfig({ windowLimit: 'invalid', windowSize: 60 });
// @ts-expect-error -- the supported schema retains its method union.
const invalidMethod: HttpMethod = 'INVALID';
void invalidMethod;
void listFunction; void listFunctions; void listFunctionsFiles; void zipFunction; void zipFunctions;
