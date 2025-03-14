import React, { forwardRef, useCallback } from 'react';
import { useRouteLoaderData } from 'react-router-dom';

import { toKebabCase } from '../../../common/misc';
import * as requestOperations from '../../../models/helpers/request-operations';
import { incrementDeletedRequests } from '../../../models/stats';
import { WebSocketRequest } from '../../../models/websocket-request';
import { updateRequestMetaByParentId } from '../../hooks/create-request';
import { RootLoaderData } from '../../routes/root';
import { Dropdown, DropdownButton, type DropdownHandle, DropdownItem, type DropdownProps, DropdownSection, ItemContent } from '../base/dropdown';
import { showPrompt } from '../modals';
interface Props extends Omit<DropdownProps, 'children' > {
  handleDuplicateRequest: Function;
  isPinned: Boolean;
  request: WebSocketRequest;
  handleShowSettings: () => void;
}

export const WebSocketRequestActionsDropdown = forwardRef<DropdownHandle, Props>(({
  handleDuplicateRequest,
  isPinned,
  handleShowSettings,
  request,
}, ref) => {
  const {
    settings,
  } = useRouteLoaderData('root') as RootLoaderData;
  const { hotKeyRegistry } = settings;

  const duplicate = useCallback(() => {
    handleDuplicateRequest(request);
  }, [handleDuplicateRequest, request]);

  const handleRename = useCallback(() => {
    showPrompt({
      title: 'Rename Request',
      defaultValue: request.name,
      submitName: 'Rename',
      selectText: true,
      label: 'Name',
      onComplete: name => {
        requestOperations.update(request, { name });
      },
    });
  }, [request]);

  const togglePin = useCallback(() => {
    updateRequestMetaByParentId(request._id, { pinned: !isPinned });
  }, [isPinned, request]);

  const deleteRequest = useCallback(() => {
    incrementDeletedRequests();
    requestOperations.remove(request);
  }, [request]);

  return (
    <Dropdown
      ref={ref}
      aria-label="Websocket Request Actions Dropdown"
      dataTestId={`Dropdown-${toKebabCase(request.name)}`}
      triggerButton={
        <DropdownButton>
          <i className="fa fa-caret-down" />
        </DropdownButton>
      }
    >
      <DropdownItem aria-label='Duplicate'>
        <ItemContent
          icon="copy"
          label="Duplicate"
          hint={hotKeyRegistry.request_showDuplicate}
          onClick={duplicate}
        />
      </DropdownItem>
      <DropdownItem aria-label={isPinned ? 'Unpin' : 'Pin'}>
        <ItemContent
          icon="thumb-tack"
          label={isPinned ? 'Unpin' : 'Pin'}
          hint={hotKeyRegistry.request_togglePin}
          onClick={togglePin}
        />
      </DropdownItem>
      <DropdownItem aria-label='Rename'>
        <ItemContent
          icon="edit"
          label="Rename"
          onClick={handleRename}
        />
      </DropdownItem>
      <DropdownItem aria-label='Delete'>
        <ItemContent
          icon="trash-o"
          label="Delete"
          hint={hotKeyRegistry.request_showDelete}
          withPrompt
          onClick={deleteRequest}
        />
      </DropdownItem>
      <DropdownSection aria-label='Settings section'>
        <DropdownItem aria-label='Settings'>
          <ItemContent
            // dataTestId={`DropdownItemSettings-${toKebabCase(request.name)}`}
            icon="wrench"
            label="Settings"
            hint={hotKeyRegistry.request_showSettings}
            onClick={handleShowSettings}
          />
        </DropdownItem>
      </DropdownSection>
    </Dropdown>
  );
});

WebSocketRequestActionsDropdown.displayName = 'WebSocketRequestActionsDropdown';
