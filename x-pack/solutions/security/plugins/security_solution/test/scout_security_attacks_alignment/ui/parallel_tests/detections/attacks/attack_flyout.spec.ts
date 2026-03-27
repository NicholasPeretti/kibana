/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { spaceTest, tags } from '@kbn/scout-security';
import { expect } from '@kbn/scout-security/ui';
import {
  seedAttackDataForSpace,
  seedAttackScheduleForSpace,
} from '../../../../../utils/seed_attack_data_for_space';

const ENABLE_ALERTS_AND_ATTACKS_ALIGNMENT_SETTING =
  'securitySolution:enableAlertsAndAttacksAlignment';

spaceTest.describe(
  'Attack details flyout',
  { tag: [...tags.stateful.classic, ...tags.serverless.security.complete] },
  () => {
    spaceTest.beforeAll(async ({ kbnClient, scoutSpace }) => {
      await seedAttackDataForSpace({ kbnClient, spaceId: scoutSpace.id });
      await seedAttackScheduleForSpace({ kbnClient, spaceId: scoutSpace.id });
    });

    spaceTest.beforeEach(async ({ browserAuth, scoutSpace }) => {
      await scoutSpace.uiSettings.set({
        [ENABLE_ALERTS_AND_ATTACKS_ALIGNMENT_SETTING]: true,
      });
      await browserAuth.loginAsAdmin();
    });

    spaceTest.afterEach(async ({ scoutSpace }) => {
      await scoutSpace.uiSettings.unset(ENABLE_ALERTS_AND_ATTACKS_ALIGNMENT_SETTING);
    });

    spaceTest(
      'shows Insights (with Correlations) and Notes in attack details flyout',
      async ({ pageObjects }) => {
        const { detectionsAttackDiscoveryPage, attackDetailsRightPanelPage } = pageObjects;

        await detectionsAttackDiscoveryPage.navigateToAttacksPage();
        await expect(detectionsAttackDiscoveryPage.attacksTableSection).toBeAttached();
        await detectionsAttackDiscoveryPage.attacksTableSection.scrollIntoViewIfNeeded();
        await expect(detectionsAttackDiscoveryPage.attacksTableSection).toBeVisible();
        await expect(detectionsAttackDiscoveryPage.tableExpandAttackDetailsButtons).toHaveCount(1);
        await expect(detectionsAttackDiscoveryPage.tableExpandAttackDetailsButtons).toBeVisible();

        await detectionsAttackDiscoveryPage.openFirstAttackDetailsFromTable();

        await expect(attackDetailsRightPanelPage.detailsFlyoutBody).toBeAttached();
        await attackDetailsRightPanelPage.detailsFlyoutBody.scrollIntoViewIfNeeded();
        await expect(attackDetailsRightPanelPage.detailsFlyoutBody).toBeVisible();

        await expect(attackDetailsRightPanelPage.insightsSectionHeader).toBeAttached();
        await attackDetailsRightPanelPage.insightsSectionHeader.scrollIntoViewIfNeeded();
        await expect(attackDetailsRightPanelPage.insightsSectionHeader).toBeVisible();
        await attackDetailsRightPanelPage.expandInsightsSectionIfCollapsed();
        await expect(attackDetailsRightPanelPage.insightsSectionContent).toBeAttached();
        await attackDetailsRightPanelPage.insightsSectionContent.scrollIntoViewIfNeeded();
        await expect(attackDetailsRightPanelPage.insightsSectionContent).toBeVisible();

        await expect(attackDetailsRightPanelPage.correlationsSection).toBeAttached();
        await attackDetailsRightPanelPage.correlationsSection.scrollIntoViewIfNeeded();
        await expect(attackDetailsRightPanelPage.correlationsSection).toBeVisible();

        await expect(attackDetailsRightPanelPage.notesTitle).toBeAttached();
        await attackDetailsRightPanelPage.notesTitle.scrollIntoViewIfNeeded();
        await expect(attackDetailsRightPanelPage.notesTitle).toBeVisible();
      }
    );
  }
);
