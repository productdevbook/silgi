import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('docs/*', 'routes/docs.tsx'),
  route('api/search', 'routes/search.ts'),
] satisfies RouteConfig;
