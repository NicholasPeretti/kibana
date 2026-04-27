/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import Path from 'path';

import {
  createTestServers,
  getSupertest,
  type TestElasticsearchUtils,
  type TestKibanaUtils,
} from '@kbn/core-test-helpers-kbn-server';
import { seedEsArchive } from './lib/helpers';

const logFilePath = Path.join(__dirname, 'timeline_migrations_8_0_id.log');

const SPACE_ID = 'awesome-space';
const OLD_TIMELINE_ID = '1e2e9850-25f8-11ec-a981-b77847c6ef30';
const MIGRATED_EVENT_ID = 'StU_UXwBAowmaxx6YdiS';

const ES_ARCHIVE_PATH =
  'x-pack/solutions/security/test/fixtures/es_archives/security_solution/timelines/7.15.0_space';

const resolveUrl = `/s/${SPACE_ID}/api/timeline/resolve`;

interface ResolvedTimeline {
  outcome: string;
  alias_target_id?: string;
  timeline: {
    title: string;
    savedObjectId: string;
    notes?: Array<{ eventId?: string; timelineId?: string }>;
    pinnedEventsSaveObject?: Array<{ eventId?: string; timelineId?: string }>;
  };
}

describe('Timeline saved-object migrations — 8.0 id alias', () => {
  let esServer: TestElasticsearchUtils;
  let kibanaServer: TestKibanaUtils;

  beforeAll(async () => {
    const { startES, startKibana } = createTestServers({
      adjustTimeout: (t) => jest.setTimeout(t),
      settings: {
        es: { license: 'trial' },
        kbn: {
          logging: {
            appenders: {
              file: {
                type: 'file',
                fileName: logFilePath,
                layout: { type: 'json' },
              },
            },
            root: { level: 'warn' },
          },
          cliArgs: { oss: false },
        },
      },
    });

    // Phase 1: start ES only, then seed pre-8.0 saved-object data so the
    // Kibana migration framework finds the legacy .kibana_1 index on boot.
    esServer = await startES();
    const esClient = esServer.es.getClient();
    await seedEsArchive(esClient, ES_ARCHIVE_PATH);

    // Phase 2: start Kibana — migration runs, converts space-namespaced documents
    // from .kibana_1 to dedicated space indices and records id aliases.
    kibanaServer = await startKibana();

    // Create the awesome-space space so the /s/{spaceId}/ URL prefix is recognised.
    await getSupertest(kibanaServer.root, 'post', '/api/spaces/space')
      .send({ id: SPACE_ID, name: SPACE_ID, disabledFeatures: [] })
      .expect(200);
  });

  afterAll(async () => {
    await kibanaServer?.stop();
    await esServer?.stop();
  });

  it('returns aliasMatch outcome with alias_target_id', async () => {
    const response = await getSupertest(kibanaServer.root, 'get', resolveUrl)
      .query({ id: OLD_TIMELINE_ID })
      .expect(200);

    const body = response.body as ResolvedTimeline;
    expect(body.outcome).toBe('aliasMatch');
    expect(body.alias_target_id).toBeDefined();
    expect(body.timeline.title).toBe('An awesome timeline');
  });

  it('returns notes with correct eventId and timelineId rewritten to resolved savedObjectId', async () => {
    const response = await getSupertest(kibanaServer.root, 'get', resolveUrl)
      .query({ id: OLD_TIMELINE_ID })
      .expect(200);

    const body = response.body as ResolvedTimeline;
    const resolvedId = body.timeline.savedObjectId;

    expect(body.timeline.notes?.some((n) => n.eventId === MIGRATED_EVENT_ID)).toBe(true);
    expect(body.timeline.notes?.every((n) => n.timelineId === resolvedId)).toBe(true);
  });

  it('returns pinned events with correct eventId and timelineId rewritten to resolved savedObjectId', async () => {
    const response = await getSupertest(kibanaServer.root, 'get', resolveUrl)
      .query({ id: OLD_TIMELINE_ID })
      .expect(200);

    const body = response.body as ResolvedTimeline;
    const resolvedId = body.timeline.savedObjectId;

    expect(body.timeline.pinnedEventsSaveObject?.some((p) => p.eventId === MIGRATED_EVENT_ID)).toBe(
      true
    );
    expect(body.timeline.pinnedEventsSaveObject?.every((p) => p.timelineId === resolvedId)).toBe(
      true
    );
  });
});
