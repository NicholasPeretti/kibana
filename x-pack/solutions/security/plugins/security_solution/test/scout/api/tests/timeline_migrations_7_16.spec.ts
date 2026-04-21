/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Client } from '@elastic/elasticsearch';
import { EsArchiver } from '@kbn/es-archiver';
import { REPO_ROOT } from '@kbn/repo-info';
import { ALL_SAVED_OBJECT_INDICES } from '@kbn/core-saved-objects-server';
import { createEsClientForTesting } from '@kbn/test-es-server';
import type { RoleApiCredentials } from '@kbn/scout-security';
import { apiTest, tags } from '@kbn/scout-security';
import { expect } from '@kbn/scout-security/api';
import {
  noteSavedObjectType,
  pinnedEventSavedObjectType,
  timelineSavedObjectType,
} from '../../../../server/lib/timeline/saved_object_mappings';
import { TIMELINE_URL } from '../../../../common/constants';
import type {
  BareNoteWithoutExternalRefs,
  BarePinnedEventWithoutExternalRefs,
  TimelineWithoutExternalRefs,
} from '../../../../common/api/timeline';

const ES_ARCHIVE_PATH =
  'x-pack/solutions/security/test/fixtures/es_archives/security_solution/timelines/7.15.0';

const NOTES_TIMELINE_ID = '6484cc90-126e-11ec-83d2-db1096c73738';
const SAVED_QUERY_TIMELINE_ID = '8dc70950-1012-11ec-9ad3-2d7c6600c0f7';

interface ScoutConfigLike {
  metadata?: {
    config?: {
      servers?: {
        elasticsearch?: {
          username?: string;
          password?: string;
        };
      };
    };
  };
}

interface TimelineWithoutSavedQueryId {
  [timelineSavedObjectType]: TimelineWithoutExternalRefs;
}

interface NoteWithoutTimelineId {
  [noteSavedObjectType]: BareNoteWithoutExternalRefs;
}

interface PinnedEventWithoutTimelineId {
  [pinnedEventSavedObjectType]: BarePinnedEventWithoutExternalRefs;
}

interface TimelineResponse {
  title?: string;
  savedQueryId?: string;
  notes?: Array<{ eventId?: string; timelineId?: string }>;
  pinnedEventsSaveObject?: Array<{ eventId?: string; timelineId?: string }>;
}

const getEsServiceCredentials = (
  config: ScoutConfigLike
): { username: string; password: string } => {
  const esConfig = config.metadata?.config?.servers?.elasticsearch;

  if (!esConfig?.username || !esConfig?.password) {
    throw new Error('Unable to read Elasticsearch service credentials from Scout config metadata.');
  }

  return {
    username: esConfig.username,
    password: esConfig.password,
  };
};

const getSavedObjectsByIds = async <T>({
  esClient,
  savedObjectType,
  ids,
}: {
  esClient: Client;
  savedObjectType: string;
  ids: string[];
}): Promise<T[]> => {
  const response = await esClient.search<T>({
    index: ALL_SAVED_OBJECT_INDICES,
    ignore_unavailable: true,
    query: {
      bool: {
        filter: [
          {
            ids: {
              values: ids,
            },
          },
          {
            term: {
              type: {
                value: savedObjectType,
              },
            },
          },
        ],
      },
    },
  });

  return response.hits.hits
    .map((hit) => hit._source)
    .filter((source): source is T => source !== undefined);
};

apiTest.describe('Timeline migrations 7.16.0', { tag: [...tags.stateful.security] }, () => {
  let adminApiCredentials: RoleApiCredentials;
  let scopedEsClient: Client;
  let scopedEsArchiver: EsArchiver;

  apiTest.beforeAll(async ({ requestAuth, kbnClient, config, log }) => {
    adminApiCredentials = await requestAuth.getApiKey('admin');
    const { username, password } = getEsServiceCredentials(config);

    scopedEsClient = createEsClientForTesting({
      esUrl: config.hosts.elasticsearch,
      isCloud: config.isCloud,
      authOverride: { username, password },
    });

    scopedEsArchiver = new EsArchiver({
      log,
      client: scopedEsClient,
      baseDir: REPO_ROOT,
      kbnClient,
    });

    await scopedEsArchiver.loadIfNeeded(ES_ARCHIVE_PATH);
  });

  apiTest.afterAll(async () => {
    await scopedEsArchiver.unload(ES_ARCHIVE_PATH);
    await scopedEsClient.close();
  });

  apiTest('removes notes timelineId in saved objects', async ({ apiClient, esClient }) => {
    const notes = await getSavedObjectsByIds<NoteWithoutTimelineId>({
      esClient,
      savedObjectType: noteSavedObjectType,
      ids: [
        'siem-ui-timeline-note:989002c0-126e-11ec-83d2-db1096c73738',
        'siem-ui-timeline-note:f09b5980-1271-11ec-83d2-db1096c73738',
      ],
    });

    expect(notes).toHaveLength(2);
    for (const note of notes) {
      expect(
        Object.prototype.hasOwnProperty.call(note[noteSavedObjectType] ?? {}, 'timelineId')
      ).toBe(false);
    }

    const response = (await apiClient.get(`${TIMELINE_URL}?id=${NOTES_TIMELINE_ID}`, {
      headers: {
        ...adminApiCredentials.apiKeyHeader,
        'kbn-xsrf': 'scout',
      },
      responseType: 'json',
    })) as { statusCode: number; body: TimelineResponse };

    expect(response.statusCode).toBe(200);
    expect(response.body.notes?.[0].timelineId).toBe(NOTES_TIMELINE_ID);
    expect(response.body.notes?.[1].timelineId).toBe(NOTES_TIMELINE_ID);
  });

  apiTest(
    'preserves notes eventId and returns timelineId in timeline response',
    async ({ apiClient }) => {
      const response = (await apiClient.get(`${TIMELINE_URL}?id=${NOTES_TIMELINE_ID}`, {
        headers: {
          ...adminApiCredentials.apiKeyHeader,
          'kbn-xsrf': 'scout',
        },
        responseType: 'json',
      })) as { statusCode: number; body: TimelineResponse };

      expect(response.statusCode).toBe(200);
      expect(response.body.notes?.[0].eventId).toBe('Edo00XsBEVtyvU-8LGNe');
      expect(response.body.notes?.[0].timelineId).toBe(NOTES_TIMELINE_ID);
      expect(response.body.notes?.[1].timelineId).toBe(NOTES_TIMELINE_ID);
    }
  );

  apiTest(
    'removes savedQueryId in saved object and preserves response field',
    async ({ apiClient }) => {
      const timelines = await getSavedObjectsByIds<TimelineWithoutSavedQueryId>({
        esClient: scopedEsClient,
        savedObjectType: timelineSavedObjectType,
        ids: ['siem-ui-timeline:8dc70950-1012-11ec-9ad3-2d7c6600c0f7'],
      });

      expect(timelines).toHaveLength(1);
      expect(
        Object.prototype.hasOwnProperty.call(
          timelines[0][timelineSavedObjectType] ?? {},
          'savedQueryId'
        )
      ).toBe(false);

      const response = (await apiClient.get(`${TIMELINE_URL}?id=${SAVED_QUERY_TIMELINE_ID}`, {
        headers: {
          ...adminApiCredentials.apiKeyHeader,
          'kbn-xsrf': 'scout',
        },
        responseType: 'json',
      })) as { statusCode: number; body: TimelineResponse };

      expect(response.statusCode).toBe(200);
      expect(response.body.title).toBe('Awesome Timeline');
      expect(response.body.savedQueryId).toBe("It's me");
    }
  );

  apiTest('removes pinned events timelineId in saved objects', async ({ apiClient, esClient }) => {
    const pinnedEvents = await getSavedObjectsByIds<PinnedEventWithoutTimelineId>({
      esClient,
      savedObjectType: pinnedEventSavedObjectType,
      ids: [
        'siem-ui-timeline-pinned-event:7a9a5540-126e-11ec-83d2-db1096c73738',
        'siem-ui-timeline-pinned-event:98d919b0-126e-11ec-83d2-db1096c73738',
      ],
    });

    expect(pinnedEvents).toHaveLength(2);
    for (const pinnedEvent of pinnedEvents) {
      expect(
        Object.prototype.hasOwnProperty.call(
          pinnedEvent[pinnedEventSavedObjectType] ?? {},
          'timelineId'
        )
      ).toBe(false);
    }

    const response = (await apiClient.get(`${TIMELINE_URL}?id=${NOTES_TIMELINE_ID}`, {
      headers: {
        ...adminApiCredentials.apiKeyHeader,
        'kbn-xsrf': 'scout',
      },
      responseType: 'json',
    })) as { statusCode: number; body: TimelineResponse };

    expect(response.statusCode).toBe(200);
    expect(response.body.pinnedEventsSaveObject?.[0].timelineId).toBe(NOTES_TIMELINE_ID);
    expect(response.body.pinnedEventsSaveObject?.[1].timelineId).toBe(NOTES_TIMELINE_ID);
  });

  apiTest(
    'preserves pinned events eventId and returns timelineId in timeline response',
    async ({ apiClient }) => {
      const response = (await apiClient.get(`${TIMELINE_URL}?id=${NOTES_TIMELINE_ID}`, {
        headers: {
          ...adminApiCredentials.apiKeyHeader,
          'kbn-xsrf': 'scout',
        },
        responseType: 'json',
      })) as { statusCode: number; body: TimelineResponse };

      expect(response.statusCode).toBe(200);
      expect(response.body.pinnedEventsSaveObject?.[0].eventId).toBe('DNo00XsBEVtyvU-8LGNe');
      expect(response.body.pinnedEventsSaveObject?.[1].eventId).toBe('Edo00XsBEVtyvU-8LGNe');
      expect(response.body.pinnedEventsSaveObject?.[0].timelineId).toBe(NOTES_TIMELINE_ID);
      expect(response.body.pinnedEventsSaveObject?.[1].timelineId).toBe(NOTES_TIMELINE_ID);
    }
  );
});
