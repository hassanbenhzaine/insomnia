import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useRouteLoaderData } from 'react-router-dom';
import styled from 'styled-components';

import { AuthType, CONTENT_TYPE_JSON } from '../../../common/constants';
import { getRenderContext, render, RENDER_PURPOSE_SEND } from '../../../common/render';
import * as models from '../../../models';
import { Environment } from '../../../models/environment';
import { WebSocketRequest } from '../../../models/websocket-request';
import { buildQueryStringFromParams, joinUrlAndQueryString } from '../../../utils/url/querystring';
import { useReadyState } from '../../hooks/use-ready-state';
import { useActiveRequestSyncVCSVersion, useGitVCSVersion } from '../../hooks/use-vcs-version';
import { selectActiveRequestMeta } from '../../redux/selectors';
import { RootLoaderData } from '../../routes/root';
import { TabItem, Tabs } from '../base/tabs';
import { CodeEditor, CodeEditorHandle } from '../codemirror/code-editor';
import { AuthDropdown } from '../dropdowns/auth-dropdown';
import { WebSocketPreviewModeDropdown } from '../dropdowns/websocket-preview-mode';
import { AuthWrapper } from '../editors/auth/auth-wrapper';
import { QueryEditorContainer, QueryEditorPreview } from '../editors/query-editor';
import { RequestHeadersEditor } from '../editors/request-headers-editor';
import { RequestParametersEditor } from '../editors/request-parameters-editor';
import { ErrorBoundary } from '../error-boundary';
import { MarkdownPreview } from '../markdown-preview';
import { showAlert, showModal } from '../modals';
import { RequestRenderErrorModal } from '../modals/request-render-error-modal';
import { RequestSettingsModal } from '../modals/request-settings-modal';
import { Pane, PaneHeader as OriginalPaneHeader } from '../panes/pane';
import { RenderedQueryString } from '../rendered-query-string';
import { WebSocketActionBar } from './action-bar';

const supportedAuthTypes: AuthType[] = ['apikey', 'basic', 'bearer'];

const SendMessageForm = styled.form({
  width: '100%',
  height: '100%',
  position: 'relative',
  boxSizing: 'border-box',
});
const SendButton = styled.button<{ isConnected: boolean }>(({ isConnected }) => ({
  padding: '0 var(--padding-md)',
  marginLeft: 'var(--padding-xs)',
  height: '100%',
  border: '1px solid var(--hl-lg)',
  borderRadius: 'var(--radius-md)',
  background: isConnected ? 'var(--color-surprise)' : 'inherit',
  color: isConnected ? 'var(--color-font-surprise)' : 'inherit',
  ':hover': {
    filter: 'brightness(0.8)',
  },
}));

const PaneSendButton = styled.div({
  display: 'flex',
  flexDirection: 'row',
  justifyContent: 'flex-end',
  boxSizing: 'border-box',
  height: 'var(--line-height-sm)',
  borderBottom: '1px solid var(--hl-lg)',
  padding: 3,
});
const PaneHeader = styled(OriginalPaneHeader)({
  '&&': { alignItems: 'stretch' },
});
const PaneReadOnlyBannerContainer = styled.div({
  paddingTop: 'var(--padding-md)',
  paddingLeft: 'var(--padding-md)',
  paddingRight: 'var(--padding-md)',
});
const PaneReadOnlyBanner = () => {
  return (
    <PaneReadOnlyBannerContainer>
      <p className="notice info no-margin-top no-margin-bottom">
        This section is now locked since the connection has already been established. To change these settings, please disconnect first.
      </p>
    </PaneReadOnlyBannerContainer>
  );
};

const QueryEditorWrapper = styled.div({
  flex: '1 0 auto',
  overflowY: 'auto',
});

interface FormProps {
  request: WebSocketRequest;
  previewMode: string;
  environmentId: string;
  workspaceId: string;
}

const WebSocketRequestForm: FC<FormProps> = ({
  request,
  previewMode,
  environmentId,
  workspaceId,
}) => {
  const editorRef = useRef<CodeEditorHandle>(null);

  useEffect(() => {
    const init = async () => {
      const payload = await models.webSocketPayload.getByParentId(request._id);
      const msg = payload?.value || '';
      editorRef.current?.setValue(msg);
    };

    init();
  }, [request._id]);
  // NOTE: Nunjucks interpolation can throw errors
  const interpolateOpenAndSend = async (payload: string) => {
    try {
      const renderContext = await getRenderContext({ request, environmentId, purpose: RENDER_PURPOSE_SEND });
      const renderedMessage = await render(payload, renderContext);
      const readyState = await window.main.webSocket.readyState.getCurrent({ requestId: request._id });
      if (!readyState) {
        const workspaceCookieJar = await models.cookieJar.getOrCreateForParentId(workspaceId);
        const rendered = await render({
          url: request.url,
          headers: request.headers,
          authentication: request.authentication,
          parameters: request.parameters.filter(p => !p.disabled),
          workspaceCookieJar,
        }, renderContext);
        window.main.webSocket.open({
          requestId: request._id,
          workspaceId,
          url: joinUrlAndQueryString(rendered.url, buildQueryStringFromParams(rendered.parameters)),
          headers: rendered.headers,
          authentication: rendered.authentication,
          cookieJar: rendered.workspaceCookieJar,
          initialPayload: renderedMessage,
        });
        return;
      }
      window.main.webSocket.event.send({ requestId: request._id, payload: renderedMessage });
    } catch (err) {
      if (err.type === 'render') {
        showModal(RequestRenderErrorModal, {
          request,
          error: err,
        });
      } else {
        showAlert({
          title: 'Unexpected Request Failure',
          message: (
            <div>
              <p>The request failed due to an unhandled error:</p>
              <code className="wide selectable">
                <pre>{err.message}</pre>
              </code>
            </div>
          ),
        });
      }
    }
  };

  const upsertPayloadWithValue = async (value: string) => {
    const payload = await models.webSocketPayload.getByParentId(request._id);
    if (payload) {
      await models.webSocketPayload.update(payload, { value });
    } else {
      await models.webSocketPayload.create({
        parentId: request._id,
        value,
        mode: previewMode,
      });
    }
  };

  // TODO(@dmarby): Wrap the CodeEditor in a NunjucksEnabledProvider here?
  // To allow for disabling rendering of messages based on a per-request setting.
  // Same as with regular requests
  return (
    <SendMessageForm
      id="websocketMessageForm"
      onSubmit={event => {
        event.preventDefault();
        interpolateOpenAndSend(editorRef.current?.getValue() || '');
      }}
    >
      <CodeEditor
        showPrettifyButton
        uniquenessKey={request._id}
        mode={previewMode}
        ref={editorRef}
        onChange={upsertPayloadWithValue}
        enableNunjucks
      />
    </SendMessageForm>
  );
};

interface Props {
  request: WebSocketRequest;
  workspaceId: string;
  environment: Environment | null;
}

// requestId is something we can read from the router params in the future.
// essentially we can lift up the states and merge request pane and response pane into a single page and divide the UI there.
// currently this is blocked by the way page layout divide the panes with dragging functionality
// TODO: @gatzjames discuss above assertion in light of request and settings drills
// TODO: use the same readystate interface
export const WebSocketRequestPane: FC<Props> = ({ request, workspaceId, environment }) => {
  const readyState = useReadyState({ requestId: request._id, protocol: 'webSocket' });
  const {
    settings,
  } = useRouteLoaderData('root') as RootLoaderData;
  const { useBulkParametersEditor } = settings;

  const disabled = readyState;
  const handleOnChange = (url: string) => {
    if (url !== request.url) {
      models.webSocketRequest.update(request, { url });
    }
  };
  const [previewMode, setPreviewMode] = useState(CONTENT_TYPE_JSON);

  useEffect(() => {
    let isMounted = true;
    const fn = async () => {
      const payload = await models.webSocketPayload.getByParentId(request._id);
      if (isMounted && payload) {
        setPreviewMode(payload.mode);
      }
    };
    fn();
    return () => {
      isMounted = false;
    };
  }, [request._id]);

  const changeMode = (mode: string) => {
    setPreviewMode(mode);
    upsertPayloadWithMode(mode);
  };

  const upsertPayloadWithMode = async (mode: string) => {
    // @TODO: multiple payloads
    const payload = await models.webSocketPayload.getByParentId(request._id);
    if (payload) {
      await models.webSocketPayload.update(payload, { mode });
    } else {
      await models.webSocketPayload.create({
        parentId: request._id,
        value: '',
        mode,
      });
    }
  };

  const handleEditDescription = useCallback(() => {
    showModal(RequestSettingsModal, { request });
  }, [request]);

  const handleEditDescriptionAdd = useCallback(() => {
    showModal(RequestSettingsModal, { request, forceEditMode: true });
  }, [request]);

  const gitVersion = useGitVCSVersion();
  const activeRequestSyncVersion = useActiveRequestSyncVCSVersion();
  const activeRequestMeta = useSelector(selectActiveRequestMeta);

  // Reset the response pane state when we switch requests, the environment gets modified, or the (Git|Sync)VCS version changes
  const uniqueKey = `${environment?.modified}::${request?._id}::${gitVersion}::${activeRequestSyncVersion}::${activeRequestMeta?.activeResponseId}`;

  return (
    <Pane type="request">
      <PaneHeader>
        <WebSocketActionBar
          key={uniqueKey}
          request={request}
          workspaceId={workspaceId}
          environmentId={environment?._id || ''}
          defaultValue={request.url}
          readyState={readyState}
          onChange={handleOnChange}
        />
      </PaneHeader>
      <Tabs aria-label="Websocket request pane tabs">
        <TabItem key="websocket-preview-mode" title={<WebSocketPreviewModeDropdown previewMode={previewMode} onClick={changeMode} />}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
            }}
          >
            <PaneSendButton>
              <SendButton
                type="submit"
                form="websocketMessageForm"
                isConnected={readyState}
              >
                Send
              </SendButton>
            </PaneSendButton>
            <WebSocketRequestForm
              key={uniqueKey}
              request={request}
              previewMode={previewMode}
              environmentId={environment?._id || ''}
              workspaceId={workspaceId}
            />
          </div>
        </TabItem>
        <TabItem key="auth" title={<AuthDropdown authTypes={supportedAuthTypes} disabled={disabled} />}>
          {disabled && <PaneReadOnlyBanner />}
          <AuthWrapper
            key={uniqueKey}
            disabled={disabled}
          />
        </TabItem>
        <TabItem key="query" title="Query">
          <QueryEditorContainer>
            {disabled && <PaneReadOnlyBanner />}
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
            <QueryEditorWrapper>
              <ErrorBoundary
                key={uniqueKey}
                errorClassName="tall wide vertically-align font-error pad text-center"
              >
                <RequestParametersEditor
                  request={request}
                  bulk={useBulkParametersEditor}
                  disabled={disabled}
                />
              </ErrorBoundary>
            </QueryEditorWrapper>
          </QueryEditorContainer>
        </TabItem>
        <TabItem key="headers" title="Headers">
          {disabled && <PaneReadOnlyBanner />}
          <RequestHeadersEditor
            key={uniqueKey}
            request={request}
            bulk={false}
            isDisabled={readyState}
          />
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
          {request.description ? (
            <div>
              <div className="pull-right pad bg-default">
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
        </TabItem>
      </Tabs>
    </Pane>
  );
};
