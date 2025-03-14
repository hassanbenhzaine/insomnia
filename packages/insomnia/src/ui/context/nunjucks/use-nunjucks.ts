import { useCallback } from 'react';
import { useSelector } from 'react-redux';
import { useRouteLoaderData } from 'react-router-dom';

import { getRenderContext, getRenderContextAncestors, HandleGetRenderContext, HandleRender, render } from '../../../common/render';
import { NUNJUCKS_TEMPLATE_GLOBAL_PROPERTY_NAME } from '../../../templating';
import { getKeys } from '../../../templating/utils';
import { selectActiveRequest } from '../../redux/selectors';
import { WorkspaceLoaderData } from '../../routes/workspace';
let getRenderContextPromiseCache: any = {};

export const initializeNunjucksRenderPromiseCache = () => {
  getRenderContextPromiseCache = {};
};

initializeNunjucksRenderPromiseCache();

/**
 * Access to functions useful for Nunjucks rendering
 */
export const useNunjucks = () => {
  const request = useSelector(selectActiveRequest);
  const {
    activeWorkspace,
    activeEnvironment,
  } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  const fetchRenderContext = useCallback(async () => {
    const ancestors = await getRenderContextAncestors(request || activeWorkspace);
    return getRenderContext({
      request: request || undefined,
      environmentId: activeEnvironment._id,
      ancestors,
    });
  }, [activeEnvironment._id, request, activeWorkspace]);

  const handleGetRenderContext: HandleGetRenderContext = useCallback(async () => {
    const context = await fetchRenderContext();
    const keys = getKeys(context, NUNJUCKS_TEMPLATE_GLOBAL_PROPERTY_NAME);
    return { context, keys };
  }, [fetchRenderContext]);

  /**
   * Heavily optimized render function
   *
   * @param text - template to render
   * @param contextCacheKey - if rendering multiple times in parallel, set this
   * @returns {Promise}
   * @private
   */
  const handleRender: HandleRender = useCallback(async <T>(obj: T, contextCacheKey: string | null = null) => {
    if (!contextCacheKey || !getRenderContextPromiseCache[contextCacheKey]) {
      // NOTE: We're caching promises here to avoid race conditions
      // @ts-expect-error -- TSCONVERSION contextCacheKey being null used as object index
      getRenderContextPromiseCache[contextCacheKey] = fetchRenderContext();
    }

    // Set timeout to delete the key eventually
    // @ts-expect-error -- TSCONVERSION contextCacheKey being null used as object index
    setTimeout(() => delete getRenderContextPromiseCache[contextCacheKey], 5000);
    // @ts-expect-error -- TSCONVERSION contextCacheKey being null used as object index
    const context = await getRenderContextPromiseCache[contextCacheKey];
    return render(obj, context);
  }, [fetchRenderContext]);

  return {
    handleRender,
    handleGetRenderContext,
  };
};
