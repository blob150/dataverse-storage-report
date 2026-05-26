import type {
  AppSettings,
  EnvironmentRow,
  StorageSnapshot,
  TenantPool,
} from '../domain/types'
import { DEFAULT_SETTINGS } from '../domain/types'

export const mockEnvironments: EnvironmentRow[] = [
  {
    id: 'env-1', environmentId: '11111111-1111-1111-1111-111111111111',
    displayName: 'Contoso Production',
    type: 'Production', region: 'unitedstates',
    ownerEmail: 'alice@contoso.com', ownerName: 'Alice Owner',
    billingModel: 'License',
    url: 'https://contoso-prod.crm.dynamics.com/',
  },
  {
    id: 'env-2', environmentId: '22222222-2222-2222-2222-222222222222',
    displayName: 'Contoso UAT',
    type: 'Sandbox', region: 'unitedstates',
    ownerEmail: 'bob@contoso.com', ownerName: 'Bob Owner',
    billingModel: 'License',
    url: 'https://contoso-uat.crm.dynamics.com/',
  },
  {
    id: 'env-3', environmentId: '33333333-3333-3333-3333-333333333333',
    displayName: 'Field Service PayGo',
    type: 'Production', region: 'unitedstates',
    ownerEmail: 'carol@contoso.com', ownerName: 'Carol Owner',
    billingModel: 'PayAsYouGo',
    payGoSubscriptionId: 'sub-abc',
    url: 'https://fs-paygo.crm.dynamics.com/',
  },
  {
    id: 'env-4', environmentId: '44444444-4444-4444-4444-444444444444',
    displayName: 'Personal Dev',
    type: 'Developer', region: 'unitedstates',
    ownerEmail: 'dan@contoso.com', ownerName: 'Dan Owner',
    billingModel: 'License',
  },
  {
    id: 'env-5', environmentId: '55555555-5555-5555-5555-555555555555',
    displayName: 'Marketing Sandbox',
    type: 'Sandbox', region: 'unitedstates',
    ownerEmail: 'eve@contoso.com', ownerName: 'Eve Owner',
    billingModel: 'License',
  },
]

const capturedAt = '2026-05-26T08:00:00Z'

export const mockSnapshots: StorageSnapshot[] = [
  {
    id: 's1', environmentId: 'env-1', capturedAt,
    database: { allocatedGb: 10, usedGb: 4.2, percent: 42 },
    file:     { allocatedGb: 20, usedGb: 19.4, percent: 97 },
    log:      { allocatedGb: 2,  usedGb: 0.6, percent: 30 },
    payGoEnabled: false, payGoConsumptionGb: 0, overageGb: 0,
  },
  {
    id: 's2', environmentId: 'env-2', capturedAt,
    database: { allocatedGb: 5, usedGb: 4.4, percent: 88 },
    file:     { allocatedGb: 10, usedGb: 3.1, percent: 31 },
    log:      { allocatedGb: 1, usedGb: 0.2, percent: 20 },
    payGoEnabled: false, payGoConsumptionGb: 0, overageGb: 0,
  },
  {
    id: 's3', environmentId: 'env-3', capturedAt,
    database: { allocatedGb: 8, usedGb: 11.0, percent: 137.5 },
    file:     { allocatedGb: 15, usedGb: 12.0, percent: 80 },
    log:      { allocatedGb: 2, usedGb: 2.1, percent: 105 },
    payGoEnabled: true, payGoConsumptionGb: 3.1, overageGb: 3.1,
  },
  {
    id: 's4', environmentId: 'env-4', capturedAt,
    database: { allocatedGb: 2, usedGb: 0.4, percent: 20 },
    file:     { allocatedGb: 2, usedGb: 0.3, percent: 15 },
    log:      { allocatedGb: 0.5, usedGb: 0.1, percent: 20 },
    payGoEnabled: false, payGoConsumptionGb: 0, overageGb: 0,
  },
  {
    id: 's5', environmentId: 'env-5', capturedAt,
    database: { allocatedGb: 3, usedGb: 2.5, percent: 83 },
    file:     { allocatedGb: 5, usedGb: 4.1, percent: 82 },
    log:      { allocatedGb: 1, usedGb: 0.3, percent: 30 },
    payGoEnabled: false, payGoConsumptionGb: 0, overageGb: 0,
  },
]

export const mockTenantPool: TenantPool = {
  id: 'pool-1', capturedAt,
  totalAllocatedGb: 250,
  totalUsedGb: 178,
  availableGb: 72,
  payGoAccrualGb: 3.1,
}

export const mockSettings: AppSettings = { ...DEFAULT_SETTINGS }
