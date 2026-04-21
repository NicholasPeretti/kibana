/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Client } from '@elastic/elasticsearch';
import { EsArchiver } from '@kbn/es-archiver';
import { REPO_ROOT } from '@kbn/repo-info';
import type { RoleApiCredentials } from '@kbn/scout-security';
import { apiTest, tags } from '@kbn/scout-security';
import { expect } from '@kbn/scout-security/api';
import { createEsClientForTesting } from '@kbn/test-es-server';

const SPACE_ID = 'awesome-space';
const RESOLVE_PATH = `/s/${SPACE_ID}/api/timeline/resolve`;
const OLD_TIMELINE_ID = '1e2e9850-25f8-11ec-a981-b77847c6ef30';
const MIGRATED_EVENT_ID = 'StU_UXwBAowmaxx6YdiS';

const ES_ARCHIVE_PATH =
  'x-pack/solutions/security/test/fixtures/es_archives/security_solution/timelines/7.15.0_space';
const KBN_ARCHIVE_PATH =
  'x-pack/solutions/security/test/fixtures/kbn_archives/timelines/7.15.0_space';

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

apiTest.describe(
  'Timeline migrations 8.0 id migration',
  { tag: [...tags.stateful.security] },
  () => {
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
      await kbnClient.spaces.create({
        id: SPACE_ID,
        name: SPACE_ID,
        disabledFeatures: [],
      });
      await kbnClient.importExport.load(KBN_ARCHIVE_PATH, { space: SPACE_ID });
    });

    apiTest.afterAll(async ({ kbnClient }) => {
      await kbnClient.importExport.unload(KBN_ARCHIVE_PATH, { space: SPACE_ID });
      await kbnClient.spaces.delete(SPACE_ID);
      await scopedEsArchiver.unload(ES_ARCHIVE_PATH);
      await scopedEsClient.close();
    });

    apiTest('returns aliasMatch outcome and resolved timeline payload', async ({ apiClient }) => {
      const response = await apiClient.get(`${RESOLVE_PATH}?id=${OLD_TIMELINE_ID}`, {
        headers: {
          ...adminApiCredentials.apiKeyHeader,
          'kbn-xsrf': 'scout',
        },
        responseType: 'json',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.outcome).toBe('aliasMatch');
      expect(response.body.alias_target_id).toBeDefined();
      expect(response.body.timeline.title).toBe('An awesome timeline');
    });

    apiTest(
      'preserves notes event id and rewrites notes timeline id to resolved id',
      async ({ apiClient }) => {
        const response = await apiClient.get(`${RESOLVE_PATH}?id=${OLD_TIMELINE_ID}`, {
          headers: {
            ...adminApiCredentials.apiKeyHeader,
            'kbn-xsrf': 'scout',
          },
          responseType: 'json',
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.timeline.notes[0].eventId).toBe(MIGRATED_EVENT_ID);
        expect(response.body.timeline.notes[0].timelineId).toBe(
          response.body.timeline.savedObjectId
        );
        expect(response.body.timeline.notes[1].timelineId).toBe(
          response.body.timeline.savedObjectId
        );
      }
    );

    apiTest(
      'preserves pinned events event id and rewrites pinned events timeline id to resolved id',
      async ({ apiClient }) => {
        const response = await apiClient.get(`${RESOLVE_PATH}?id=${OLD_TIMELINE_ID}`, {
          headers: {
            ...adminApiCredentials.apiKeyHeader,
            'kbn-xsrf': 'scout',
          },
          responseType: 'json',
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.timeline.pinnedEventsSaveObject[0].eventId).toBe(MIGRATED_EVENT_ID);
        expect(response.body.timeline.pinnedEventsSaveObject[0].timelineId).toBe(
          response.body.timeline.savedObjectId
        );
      }
    );
  }
);
