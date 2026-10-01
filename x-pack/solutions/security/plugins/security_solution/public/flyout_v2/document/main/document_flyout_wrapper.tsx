/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { memo, useCallback, useMemo } from 'react';
import { EuiFlyoutBody, EuiFlyoutHeader } from '@elastic/eui';
import { KbnDangerCallout } from '@kbn/ui-callout';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';
import { ElasticRequestState } from '@kbn/unified-doc-viewer';
import { useEsDocSearch } from '@kbn/unified-doc-viewer-plugin/public';
import { getFieldValue } from '@kbn/discover-utils';
import { EVENT_KIND } from '@kbn/rule-data-utils';
import type { CellActionRenderer } from '../../shared/components/cell_actions';
import { useAlertsPrivileges } from '../../../detections/containers/detection_engine/alerts/use_alerts_privileges';
import { FlyoutLoading } from '../../shared/components/flyout_loading';
import { FlyoutMissingAlertsPrivilege } from './components/flyout_missing_alerts_privilege';
import { DocumentPagination, useShowDocumentPagination } from './components/document_pagination';
import { DataViewDegradedCallout } from '../../../data_view_manager/components/data_view_degraded_callout';
import { PageScope } from '../../../data_view_manager/constants';
import { useDataView } from '../../../data_view_manager/hooks/use_data_view';
import { EventKind } from './constants/event_kinds';
import { DocumentFlyout } from '.';

const DATA_VIEW_ERROR = i18n.translate(
  'xpack.securitySolution.flyout.document.overviewWrapper.dataViewError',
  {
    defaultMessage: 'Unable to retrieve the data view for analyzer.',
  }
);

const DOCUMENT_NOT_FOUND = i18n.translate(
  'xpack.securitySolution.flyout.document.overviewWrapper.documentNotFound',
  {
    defaultMessage: 'Cannot find document. No documents match that ID.',
  }
);

const FETCH_ERROR = i18n.translate(
  'xpack.securitySolution.flyout.document.overviewWrapper.fetchError',
  {
    defaultMessage: 'Unable to fetch document details.',
  }
);

export interface DocumentFlyoutWrapperProps {
  /**
   * The ID of the document to display. This is required to fetch the document details.
   */
  documentId: string | undefined;
  /**
   * The name of the index that contains the document. This is required to fetch the document details.
   */
  indexName: string | undefined;
  /**
   * A function that renders cell actions for the overview tab.
   */
  renderCellActions: CellActionRenderer;
  /**
   * Callback invoked after alert mutations to refresh parent and current flyouts.
   */
  onAlertUpdated: () => void;
  /**
   * Optional test subject forwarded to the document flyout header without adding a layout wrapper.
   */
  dataTestSubj?: string;
}

/**
 * Wrapper for the DocumentFlyout component that handles fetching the document
 * based on the provided document ID and index name, and manages loading and error states.
 * It is currently used in Analyzer when opening a document from the detail panel.
 */
export const DocumentFlyoutWrapper = memo(
  ({
    documentId,
    indexName,
    renderCellActions,
    onAlertUpdated,
    dataTestSubj,
  }: DocumentFlyoutWrapperProps) => {
    const { dataView, status } = useDataView(PageScope.default);
    const showPagination = useShowDocumentPagination();

    const isDataViewLoading = status === 'loading' || status === 'pristine';
    const isDataViewInvalid = status === 'error';
    const isDataViewDegraded = status === 'ready' && !dataView.hasMatchedIndices();

    const shouldSkipSearch = useMemo(
      () => isDataViewLoading || isDataViewInvalid || !documentId || !indexName || !dataView,
      [dataView, documentId, indexName, isDataViewInvalid, isDataViewLoading]
    );

    const [requestState, hit, refetchDocument] = useEsDocSearch({
      id: documentId ?? '',
      index: indexName,
      dataView,
      skip: shouldSkipSearch,
    });

    const handleAlertUpdated = useCallback(() => {
      onAlertUpdated();
      refetchDocument();
    }, [onAlertUpdated, refetchDocument]);

    // `useEsDocSearch` keeps returning the previous hit as `Found` until the new id arrives.
    // Treat that as loading so the flyout never paints the document the pager has left.
    const hitMatchesRequest = hit != null && hit.raw._id === documentId;
    const hasSettledWithoutHit =
      requestState === ElasticRequestState.NotFound ||
      requestState === ElasticRequestState.Error ||
      requestState === ElasticRequestState.NotFoundDataView;
    const isResolving =
      !shouldSkipSearch &&
      !hasSettledWithoutHit &&
      (requestState === ElasticRequestState.Loading || !hitMatchesRequest);

    const isAlert = useMemo(
      () =>
        hitMatchesRequest &&
        hit != null &&
        (getFieldValue(hit, EVENT_KIND) as string) === EventKind.signal,
      [hit, hitMatchesRequest]
    );

    const { hasAlertsRead, loading: isAlertsPrivilegesLoading } = useAlertsPrivileges();
    const missingAlertsPrivilege = isAlert && !isAlertsPrivilegesLoading && !hasAlertsRead;

    if (isDataViewLoading || (isAlert && isAlertsPrivilegesLoading) || isResolving) {
      return (
        <LoadingState
          showPagination={showPagination}
          data-test-subj="document-overview-wrapper-loading"
        />
      );
    }

    if (missingAlertsPrivilege) {
      return <FlyoutMissingAlertsPrivilege />;
    }

    if (isDataViewInvalid) {
      return (
        <KbnDangerCallout
          announceOnMount
          title={DATA_VIEW_ERROR}
          data-test-subj="document-overview-wrapper-data-view-error"
        />
      );
    }

    if (requestState === ElasticRequestState.Found && hitMatchesRequest && hit) {
      return (
        <>
          {isDataViewDegraded && (
            <DataViewDegradedCallout
              compact
              dataView={dataView}
              data-test-subj="document-overview-wrapper-data-view-degraded"
            >
              <FormattedMessage
                id="xpack.securitySolution.flyout.document.overviewWrapper.dataViewDegradedDetailsDescription"
                defaultMessage="The document is still shown below, but field-dependent features may be limited."
              />
            </DataViewDegradedCallout>
          )}
          <DocumentFlyout
            hit={hit}
            renderCellActions={renderCellActions}
            onAlertUpdated={handleAlertUpdated}
            dataTestSubj={dataTestSubj}
          />
        </>
      );
    }

    if (
      requestState === ElasticRequestState.NotFound ||
      requestState === ElasticRequestState.Error
    ) {
      const isNotFound = requestState === ElasticRequestState.NotFound;
      return (
        <UnavailableState showPagination={showPagination}>
          <KbnDangerCallout
            announceOnMount
            title={isNotFound ? DOCUMENT_NOT_FOUND : FETCH_ERROR}
            data-test-subj={
              isNotFound ? 'document-overview-wrapper-not-found' : 'document-overview-fetch-error'
            }
          />
        </UnavailableState>
      );
    }

    return null;
  }
);

DocumentFlyoutWrapper.displayName = 'DocumentFlyoutWrapper';

const LoadingState = ({
  showPagination,
  'data-test-subj': dataTestSubj,
}: {
  showPagination: boolean;
  'data-test-subj': string;
}) => {
  if (!showPagination) {
    return <FlyoutLoading data-test-subj={dataTestSubj} />;
  }

  return (
    <>
      <EuiFlyoutHeader>
        <DocumentPagination />
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <FlyoutLoading data-test-subj={dataTestSubj} />
      </EuiFlyoutBody>
    </>
  );
};

const UnavailableState = ({
  showPagination,
  children,
}: {
  showPagination: boolean;
  children: React.ReactNode;
}) => {
  if (!showPagination) {
    return <>{children}</>;
  }

  return (
    <>
      <EuiFlyoutHeader>
        <DocumentPagination />
      </EuiFlyoutHeader>
      <EuiFlyoutBody>{children}</EuiFlyoutBody>
    </>
  );
};
