/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EsArchiver } from '@kbn/es-archiver';
import { REPO_ROOT } from '@kbn/repo-info';
import type { RoleApiCredentials } from '@kbn/scout-security';
import { apiTest, tags } from '@kbn/scout-security';
import { expect } from '@kbn/scout-security/api';

const SPACE_ID = 'awesome-space';
const RESOLVE_PATH = `/s/${SPACE_ID}/api/timeline/resolve`;
const OLD_TIMELINE_ID = '1e2e9850-25f8-11ec-a981-b77847c6ef30';
const MIGRATED_EVENT_ID = 'StU_UXwBAowmaxx6YdiS';

const ES_ARCHIVE_PATH =
  'x-pack/solutions/security/test/fixtures/es_archives/security_solution/timelines/7.15.0_space';
const KBN_ARCHIVE_PATH =
  'x-pack/solutions/security/test/fixtures/kbn_archives/timelines/7.15.0_space';

apiTest.describe(
  'Timeline migrations 8.0 id migration',
  { tag: [...tags.stateful.security] },
  () => {
    let adminApiCredentials: RoleApiCredentials;
    // The built-in Scout `esArchiver` fixture is not usable here for two reasons:
    //   1. It is constructed with `dataOnly: true`, so it will not (re)create index
    //      mappings from the archive. This suite loads a legacy `.kibana_1` archive
    //      whose saved-object mappings must be restored so Kibana's SO migration
    //      framework can be exercised against pre-8.0 timeline documents.
    //   2. The fixture only exposes `loadIfNeeded` and does not expose `unload`, but
    //      the legacy `.kibana` documents loaded here must be cleaned up in
    //      `afterAll` to avoid leaking stale SO shapes into other suites.
    // We therefore build a local (non-`dataOnly`) `EsArchiver` scoped to this suite.
    let scopedEsArchiver: EsArchiver;

    apiTest.beforeAll(async ({ esClient, kbnClient, requestAuth, log }) => {
      adminApiCredentials = await requestAuth.getApiKey('admin');

      scopedEsArchiver = new EsArchiver({
        log,
        client: esClient,
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
