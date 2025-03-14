import React, { FC, useCallback, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useRouteLoaderData } from 'react-router-dom';
import styled from 'styled-components';

import { version } from '../../../../package.json';
import { CONTENT_TYPE_FILE, CONTENT_TYPE_FORM_DATA, CONTENT_TYPE_FORM_URLENCODED, CONTENT_TYPE_GRAPHQL, CONTENT_TYPE_JSON, CONTENT_TYPE_OTHER, getContentTypeFromHeaders, METHOD_POST } from '../../../common/constants';
import { database } from '../../../common/database';
import { getContentTypeHeader } from '../../../common/misc';
import * as models from '../../../models';
import { queryAllWorkspaceUrls } from '../../../models/helpers/query-all-workspace-urls';
import { update } from '../../../models/helpers/request-operations';
import { Request, RequestBody } from '../../../models/request';
import type { Settings } from '../../../models/settings';
import { create, Workspace } from '../../../models/workspace';
import { deconstructQueryStringToParams, extractQueryStringFromUrl } from '../../../utils/url/querystring';
import { useActiveRequestSyncVCSVersion, useGitVCSVersion } from '../../hooks/use-vcs-version';
import { selectActiveRequestMeta } from '../../redux/selectors';
import { WorkspaceLoaderData } from '../../routes/workspace';
import { PanelContainer, TabItem, Tabs } from '../base/tabs';
import { AuthDropdown } from '../dropdowns/auth-dropdown';
import { ContentTypeDropdown } from '../dropdowns/content-type-dropdown';
import { AuthWrapper } from '../editors/auth/auth-wrapper';
import { BodyEditor } from '../editors/body/body-editor';
import { QueryEditor, QueryEditorContainer, QueryEditorPreview } from '../editors/query-editor';
import { RequestHeadersEditor } from '../editors/request-headers-editor';
import { RequestParametersEditor } from '../editors/request-parameters-editor';
import { ErrorBoundary } from '../error-boundary';
import { MarkdownPreview } from '../markdown-preview';
import { showModal } from '../modals';
import { RequestSettingsModal } from '../modals/request-settings-modal';
import { RenderedQueryString } from '../rendered-query-string';
import { RequestUrlBar, RequestUrlBarHandle } from '../request-url-bar';
import { Pane, PaneHeader } from './pane';
import { PlaceholderRequestPane } from './placeholder-request-pane';
const HeaderContainer = styled.div({
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  height: '100%',
  overflowY: 'auto',
});

export const TabPanelFooter = styled.div({
  boxSizing: 'content-box',
  display: 'flex',
  flexDirection: 'row',
  borderTop: '1px solid var(--hl-md)',
  height: 'var(--line-height-sm)',
  fontSize: 'var(--font-size-sm)',
  '& > button': {
    color: 'var(--hl)',
    padding: 'var(--padding-xs) var(--padding-xs)',
    height: '100%',
  },
});

const TabPanelBody = styled.div({
  overflowY: 'auto',
  flex: '1 0',
});

interface Props {
  environmentId: string;
  request?: Request | null;
  settings: Settings;
  workspace: Workspace;
  setLoading: (l: boolean) => void;
}
export function newBodyGraphQL(rawBody: string): RequestBody {
  try {
    // Only strip the newlines if rawBody is a parsable JSON
    JSON.parse(rawBody);
    return {
      mimeType: CONTENT_TYPE_GRAPHQL,
      text: rawBody.replace(/\\\\n/g, ''),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        mimeType: CONTENT_TYPE_GRAPHQL,
        text: rawBody,
      };
    } else {
      throw error;
    }
  }
}
export function updateMimeType(
  request: Request,
  mimeType: string,
  doCreate = false,
  savedBody: RequestBody = {},
) {
  let headers = request.headers ? [...request.headers] : [];
  const contentTypeHeader = getContentTypeHeader(headers);
  // GraphQL uses JSON content-type
  const contentTypeHeaderValue = mimeType === CONTENT_TYPE_GRAPHQL ? CONTENT_TYPE_JSON : mimeType;

  // GraphQL must be POST
  if (mimeType === CONTENT_TYPE_GRAPHQL) {
    request.method = METHOD_POST;
  }

  // Check if we are converting to/from variants of XML or JSON
  let leaveContentTypeAlone = false;

  if (contentTypeHeader && mimeType) {
    const current = contentTypeHeader.value;

    if (current.includes('xml') && mimeType.includes('xml')) {
      leaveContentTypeAlone = true;
    } else if (current.includes('json') && mimeType.includes('json')) {
      leaveContentTypeAlone = true;
    }
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // 1. Update Content-Type header //
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  const hasBody = typeof mimeType === 'string';

  if (!hasBody) {
    headers = headers.filter(h => h !== contentTypeHeader);
  } else if (mimeType === CONTENT_TYPE_OTHER) {
    // Leave headers alone
  } else if (mimeType && contentTypeHeader && !leaveContentTypeAlone) {
    contentTypeHeader.value = contentTypeHeaderValue;
  } else if (mimeType && !contentTypeHeader) {
    headers.push({
      name: 'Content-Type',
      value: contentTypeHeaderValue,
    });
  }
  if (!headers.find(h => h?.name?.toLowerCase() === 'user-agent')) {
    headers.push({
      name: 'User-Agent',
      value: `Insomnia/${version}`,
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // 2. Make a new request body //
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  let body;
  const oldBody = Object.keys(savedBody).length === 0 ? request.body : savedBody;

  if (mimeType === CONTENT_TYPE_FORM_URLENCODED) {
    // Urlencoded
    body = oldBody.params
      ? {
        mimeType: CONTENT_TYPE_FORM_URLENCODED,
        params: oldBody.params,
      } : {
        mimeType: CONTENT_TYPE_FORM_URLENCODED,
        params: oldBody.text ? deconstructQueryStringToParams(oldBody.text) : [],
      };
  } else if (mimeType === CONTENT_TYPE_FORM_DATA) {
    // Form Data
    body = oldBody.params
      ? {
        mimeType: CONTENT_TYPE_FORM_DATA,
        params: oldBody.params || [],
      } : {
        mimeType: CONTENT_TYPE_FORM_DATA,
        params: oldBody.text ? deconstructQueryStringToParams(oldBody.text) : [],
      };
  } else if (mimeType === CONTENT_TYPE_FILE) {
    // File
    body = {
      mimeType: CONTENT_TYPE_FILE,
      fileName: '',
    };
  } else if (mimeType === CONTENT_TYPE_GRAPHQL) {
    if (contentTypeHeader) {
      contentTypeHeader.value = CONTENT_TYPE_JSON;
    }

    body = newBodyGraphQL(oldBody.text || '');
  } else if (typeof mimeType !== 'string') {
    // No body
    body = {};
  } else {
    // Raw Content-Type (ex: application/json)
    body = typeof mimeType !== 'string' ? {
      text: oldBody.text || '',
    } : {
      mimeType: mimeType.split(';')[0],
      text: oldBody.text || '',
    };
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~ //
  // 2. create/update request //
  // ~~~~~~~~~~~~~~~~~~~~~~~~ //
  if (doCreate) {
    const newRequest: Request = Object.assign({}, request, {
      headers,
      body,
    });
    return create(newRequest);
  } else {
    return update(request, {
      headers,
      body,
    });
  }
}
export const RequestPane: FC<Props> = ({
  environmentId,
  request,
  settings,
  workspace,
  setLoading,
}) => {

  const updateRequestUrl = (request: Request, url: string) => {
    if (request.url === url) {
      return Promise.resolve(request);
    }
    return update(request, { url });
  };

  const handleEditDescription = useCallback((forceEditMode: boolean) => {
    request && showModal(RequestSettingsModal, { request, forceEditMode });
  }, [request]);

  const handleEditDescriptionAdd = useCallback(() => {
    handleEditDescription(true);
  }, [handleEditDescription]);

  const handleUpdateSettingsUseBulkHeaderEditor = useCallback(() => {
    models.settings.update(settings, { useBulkHeaderEditor: !settings.useBulkHeaderEditor });
  }, [settings]);

  const handleUpdateSettingsUseBulkParametersEditor = useCallback(() => {
    models.settings.update(settings, { useBulkParametersEditor: !settings.useBulkParametersEditor });
  }, [settings]);

  const handleImportQueryFromUrl = useCallback(() => {
    if (!request) {
      console.warn('Tried to import query when no request active');
      return;
    }

    let query;

    try {
      query = extractQueryStringFromUrl(request.url);
    } catch (error) {
      console.warn('Failed to parse url to import querystring');
      return;
    }

    // Remove the search string (?foo=bar&...) from the Url
    const url = request.url.replace(`?${query}`, '');
    const parameters = [...request.parameters, ...deconstructQueryStringToParams(query)];

    // Only update if url changed
    if (url !== request.url) {
      database.update({
        ...request,
        modified: Date.now(),
        url,
        parameters,
        // Hack to force the ui to refresh. More info on use-vcs-version
      }, true);
    }
  }, [request]);
  const gitVersion = useGitVCSVersion();
  const activeRequestSyncVersion = useActiveRequestSyncVCSVersion();

  const {
    activeEnvironment,
  } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  const activeRequestMeta = useSelector(selectActiveRequestMeta);
  // Force re-render when we switch requests, the environment gets modified, or the (Git|Sync)VCS version changes
  const uniqueKey = `${activeEnvironment?.modified}::${request?._id}::${gitVersion}::${activeRequestSyncVersion}::${activeRequestMeta?.activeResponseId}`;

  const requestUrlBarRef = useRef<RequestUrlBarHandle>(null);
  useEffect(() => {
    requestUrlBarRef.current?.focusInput();
  }, [
    request?._id, // happens when the user switches requests
    uniqueKey,
  ]);

  if (!request) {
    return (
      <PlaceholderRequestPane />
    );
  }

  async function updateRequestMimeType(mimeType: string | null): Promise<Request | null> {
    if (!request) {
      console.warn('Tried to update request mime-type when no active request');
      return null;
    }
    const requestMeta = await models.requestMeta.getOrCreateByParentId(request._id,);
    // Switched to No body
    const savedRequestBody = typeof mimeType !== 'string' ? request.body : {};
    // Clear saved value in requestMeta
    await models.requestMeta.update(requestMeta, { savedRequestBody });
    // @ts-expect-error -- TSCONVERSION mimeType can be null when no body is selected but the updateMimeType logic needs to be reexamined
    return updateMimeType(request, mimeType, false, requestMeta.savedRequestBody);
  }
  const numParameters = request.parameters.filter(p => !p.disabled).length;
  const numHeaders = request.headers.filter(h => !h.disabled).length;
  const urlHasQueryParameters = request.url.indexOf('?') >= 0;
  const contentType = getContentTypeFromHeaders(request.headers) || request.body.mimeType;
  return (
    <Pane type="request">
      <PaneHeader>
        <ErrorBoundary errorClassName="font-error pad text-center">
          <RequestUrlBar
            key={request._id}
            ref={requestUrlBarRef}
            uniquenessKey={uniqueKey}
            onUrlChange={updateRequestUrl}
            handleAutocompleteUrls={() => queryAllWorkspaceUrls(workspace._id, models.request.type, request?._id)}
            nunjucksPowerUserMode={settings.nunjucksPowerUserMode}
            request={request}
            setLoading={setLoading}
          />
        </ErrorBoundary>
      </PaneHeader>
      <Tabs aria-label="Request pane tabs">
        <TabItem key="content-type" title={<ContentTypeDropdown onChange={updateRequestMimeType} />}>
          <BodyEditor
            key={uniqueKey}
            request={request}
            workspace={workspace}
            environmentId={environmentId}
          />
        </TabItem>
        <TabItem key="auth" title={<AuthDropdown />}>
          <ErrorBoundary key={uniqueKey} errorClassName="font-error pad text-center">
            <AuthWrapper />
          </ErrorBoundary>
        </TabItem>
        <TabItem key="query" title={<>Query {numParameters > 0 && <span className="bubble space-left">{numParameters}</span>}</>}>
          <QueryEditorContainer>
            <QueryEditorPreview className="pad pad-bottom-sm">
              <label className="label--small no-pad-top">Url Preview</label>
              <code className="txt-sm block faint">
                <ErrorBoundary
                  key={uniqueKey}
                  errorClassName="tall wide vertically-align font-error pad text-center"
                >
                  <RenderedQueryString request={request} />
                </ErrorBoundary>
              </code>
            </QueryEditorPreview>
            <QueryEditor>
              <ErrorBoundary
                key={uniqueKey}
                errorClassName="tall wide vertically-align font-error pad text-center"
              >
                <RequestParametersEditor
                  key={contentType}
                  request={request}
                  bulk={settings.useBulkParametersEditor}
                />
              </ErrorBoundary>
            </QueryEditor>
            <TabPanelFooter>
              <button
                className="btn btn--compact"
                title={urlHasQueryParameters ? 'Import querystring' : 'No query params to import'}
                onClick={handleImportQueryFromUrl}
              >
                Import from URL
              </button>
              <button
                className="btn btn--compact"
                onClick={handleUpdateSettingsUseBulkParametersEditor}
              >
                {settings.useBulkParametersEditor ? 'Regular Edit' : 'Bulk Edit'}
              </button>
            </TabPanelFooter>
          </QueryEditorContainer>
        </TabItem>
        <TabItem key="headers" title={<>Headers {numHeaders > 0 && <span className="bubble space-left">{numHeaders}</span>}</>}>
          <HeaderContainer>
            <ErrorBoundary key={uniqueKey} errorClassName="font-error pad text-center">
              <TabPanelBody>
                <RequestHeadersEditor
                  request={request}
                  bulk={settings.useBulkHeaderEditor}
                />
              </TabPanelBody>
            </ErrorBoundary>

            <TabPanelFooter>
              <button
                className="btn btn--compact"
                onClick={handleUpdateSettingsUseBulkHeaderEditor}
              >
                {settings.useBulkHeaderEditor ? 'Regular Edit' : 'Bulk Edit'}
              </button>
            </TabPanelFooter>
          </HeaderContainer>
        </TabItem>
        <TabItem
          key="docs"
          title={
            <>
              Docs
              {request.description && (
                <span className="bubble space-left">
                  <i className="fa fa--skinny fa-check txt-xxs" />
                </span>
              )}
            </>
          }
        >
          <PanelContainer className="tall">
            {request.description ? (
              <div>
                <div className="pull-right pad bg-default">
                  {/* @ts-expect-error -- TSCONVERSION the click handler expects a boolean prop... */}
                  <button className="btn btn--clicky" onClick={handleEditDescription}>
                    Edit
                  </button>
                </div>
                <div className="pad">
                  <ErrorBoundary errorClassName="font-error pad text-center">
                    <MarkdownPreview
                      heading={request.name}
                      markdown={request.description}
                    />
                  </ErrorBoundary>
                </div>
              </div>
            ) : (
              <div className="overflow-hidden editor vertically-center text-center">
                <p className="pad text-sm text-center">
                  <span className="super-faint">
                    <i
                      className="fa fa-file-text-o"
                      style={{
                        fontSize: '8rem',
                        opacity: 0.3,
                      }}
                    />
                  </span>
                  <br />
                  <br />
                  <button
                    className="btn btn--clicky faint"
                    onClick={handleEditDescriptionAdd}
                  >
                    Add Description
                  </button>
                </p>
              </div>
            )}
          </PanelContainer>
        </TabItem>
      </Tabs>
    </Pane>
  );
};
