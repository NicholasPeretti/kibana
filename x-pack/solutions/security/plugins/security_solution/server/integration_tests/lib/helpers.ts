/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { v4 as uuidGen } from 'uuid';
import Fs from 'fs';
import Zlib from 'zlib';
import Path from 'path';
import Util from 'util';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { Client as EsClient } from '@elastic/elasticsearch';
import deepmerge from 'deepmerge';
import { REPO_ROOT } from '@kbn/repo-info';
import { createTestServers, createRootWithCorePlugins } from '@kbn/core-test-helpers-kbn-server';

export const DEFAULT_GET_ROUTES: Array<[RegExp, unknown]> = [
  [new RegExp('.*/ping$'), { status: 200 }],
  [
    /.*kibana\/manifest\/artifacts.*/,
    {
      status: 200,
      data: 'x-pack/solutions/security/plugins/security_solution/server/lib/telemetry/__mocks__/kibana-artifacts.zip',
    },
  ],
];

export const DEFAULT_POST_ROUTES: Array<[RegExp, unknown]> = [[/.*/, { status: 200 }]];

const asyncUnlink = Util.promisify(Fs.unlink);

/**
 * Eventually runs a callback until it succeeds or times out.
 * Inspired in https://kotest.io/docs/assertions/eventually.html
 *
 * @param cb The callback to run/retry
 * @param duration The maximum duration to run the callback, default 10000 millisecs
 * @param interval The interval between each run, default 100 millisecs
 */
export async function eventually<T>(
  cb: () => Promise<T>,
  duration: number = 120000,
  interval: number = 3000
) {
  let elapsed = 0;

  while (true) {
    const startedAt: number = performance.now();
    try {
      return await cb();
    } catch (e) {
      if (elapsed >= duration) {
        throw e;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    elapsed += performance.now() - startedAt;
  }
}

export async function setupTestServers(logFilePath: string, settings = {}) {
  const { startES } = createTestServers({
    adjustTimeout: (t) => jest.setTimeout(t),
    settings: {
      es: {
        license: 'trial',
      },
    },
  });

  const esServer = await startES();

  const root = createRootWithCorePlugins(
    deepmerge(
      {
        logging: {
          appenders: {
            file: {
              type: 'file',
              fileName: logFilePath,
              layout: {
                type: 'json',
              },
            },
          },
          root: {
            level: 'warn',
          },
          loggers: [
            {
              name: 'plugins.taskManager',
              level: 'warn',
              appenders: ['file'],
            },
            {
              name: 'plugins.securitySolution.telemetry_events',
              level: 'all',
              appenders: ['file'],
            },
          ],
        },
      },
      settings
    ),
    { oss: false }
  );

  await root.preboot();
  const coreSetup = await root.setup();
  const coreStart = await root.start();

  return {
    esServer,
    kibanaServer: {
      root,
      coreSetup,
      coreStart,
      stop: async () => root.shutdown(),
    },
  };
}

export async function removeFile(path: string) {
  await asyncUnlink(path).catch(() => void 0);
}

export async function bulkInsert(
  esClient: ElasticsearchClient,
  index: string,
  data: unknown[],
  ids: string[] = []
): Promise<void> {
  const operations = data.flatMap((d, i) => {
    const _id = ids[i] ?? uuidGen();
    return [{ create: { _index: index, _id } }, d];
  });
  await esClient.bulk({ operations, refresh: 'wait_for' }).catch(() => {});
}

export function updateTimestamps(data: object[]): object[] {
  const currentTimeMillis = new Date().getTime();
  return data.map((d, i) => {
    // wait a couple of millisecs to not make timestamps overlap
    return { ...d, '@timestamp': new Date(currentTimeMillis + (i + 1) * 100) };
  });
}

export function mockAxiosPost(
  postSpy: jest.SpyInstance,
  routes: Array<[RegExp, unknown]> = DEFAULT_POST_ROUTES
) {
  postSpy.mockImplementation(async (url: string) => {
    for (const [route, returnValue] of routes) {
      if (route.test(url)) {
        return returnValue;
      }
    }
    return { status: 404 };
  });
}

export function mockAxiosGet(
  getSpy: jest.SpyInstance,
  routes: Array<[RegExp, unknown]> = DEFAULT_GET_ROUTES
) {
  getSpy.mockImplementation(async (url: string) => {
    for (const [route, returnValue] of routes) {
      if (route.test(url)) {
        return returnValue;
      }
    }
    return { status: 404 };
  });
}

export function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface ArchiveIndexRecord {
  type: 'index';
  value: {
    index: string;
    aliases: Record<string, object>;
    mappings: Record<string, unknown>;
    settings?: Record<string, unknown>;
  };
}

interface ArchiveDocRecord {
  type: 'doc';
  value: {
    id: string;
    index: string;
    source: Record<string, unknown>;
  };
}

type ArchiveRecord = ArchiveIndexRecord | ArchiveDocRecord;

/**
 * Seeds an Elasticsearch cluster with data from an EsArchiver-format archive
 * (mappings.json + data.json.gz). Used to bootstrap legacy saved-object indices
 * before Kibana starts so the SO migration framework can exercise them.
 *
 * @param esClient - ES client connected to the target cluster
 * @param archivePath - path to the archive directory, relative to repo root
 */
export async function seedEsArchive(esClient: EsClient, archivePath: string): Promise<void> {
  const archiveDir = Path.resolve(REPO_ROOT, archivePath);

  const mappingsJson = Fs.readFileSync(Path.join(archiveDir, 'mappings.json'), 'utf8');
  const indexRecord: ArchiveIndexRecord = JSON.parse(mappingsJson);
  const { index, aliases, mappings } = indexRecord.value;

  await esClient.indices.create({
    index,
    aliases,
    mappings: mappings as Parameters<EsClient['indices']['create']>[0]['mappings'],
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
      auto_expand_replicas: 'false',
    },
  });

  const compressed = Fs.readFileSync(Path.join(archiveDir, 'data.json.gz'));
  const content = Zlib.gunzipSync(compressed).toString('utf8');

  const records: ArchiveRecord[] = content
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk) as ArchiveRecord);

  const docRecords = records.filter((r): r is ArchiveDocRecord => r.type === 'doc');

  if (docRecords.length === 0) {
    return;
  }

  const operations = docRecords.flatMap((doc) => [
    { index: { _index: doc.value.index, _id: doc.value.id } },
    doc.value.source,
  ]);

  await esClient.bulk({ operations, refresh: 'wait_for' });
}
