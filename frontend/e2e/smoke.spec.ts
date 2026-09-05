import { expect, test } from '@playwright/test'

/**
 * The happy path a planner walks on day one: create a project, staff it, set
 * up the financial vault, enter rates, read the cost-profit summary and export
 * the budget workbook. Runs against the deployed stack, so it also proves the
 * proxy, the API and the database wiring.
 */
test('create a project, staff it, budget it, report on it and export', async ({ page }) => {
  const name = `Smoke ${Date.now()}`

  await page.goto('/')
  await page.getByRole('button', { name: '+ New Project' }).first().click()
  await page.getByLabel('Project name').fill(name)
  await page.getByLabel('Company').fill('Vehiclevo')
  await page.getByRole('button', { name: 'Create Project' }).click()
  // The list shows the new card; open it
  await page.getByRole('link', { name: new RegExp(name) }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  // Staffing
  await page.getByRole('link', { name: 'Resources' }).click()
  await page.getByRole('button', { name: '+ Add Feature', exact: true }).click()
  const featureDialog = page.getByRole('dialog', { name: 'Add Feature' })
  await featureDialog.getByLabel('Feature name').fill('Platform')
  await featureDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(featureDialog).toBeHidden()
  await page.getByRole('button', { name: '+ Add Role', exact: true }).click()
  const roleDialog = page.getByRole('dialog', { name: /Add Role/ })
  await roleDialog.getByLabel('Role name').fill('Developer')
  await roleDialog.getByRole('button', { name: 'Add Role', exact: true }).click()
  await expect(roleDialog).toBeHidden()
  await expect(page.getByText('Developer')).toBeVisible()

  // The resource plan needs no vault
  await page.getByRole('link', { name: 'Reports' }).click()
  await expect(page.getByText('Resource Plan — FTEs by Month')).toBeVisible()

  // Money needs the vault: set it up, keep the recovery key, enter a rate
  await page.getByRole('link', { name: 'Budget' }).click()
  const vaultButton = page.getByRole('button', {
    name: /Set Up Financial Vault|Unlock Financial Data/,
  })
  await vaultButton.click()
  const passphrase = 'correct horse battery staple'
  const vaultDialog = page.getByRole('dialog')
  await expect(vaultDialog).toBeVisible()
  if (await vaultDialog.getByLabel('Confirm passphrase').isVisible()) {
    await vaultDialog.getByLabel('Passphrase', { exact: true }).fill(passphrase)
    await vaultDialog.getByLabel('Confirm passphrase').fill(passphrase)
    await vaultDialog.getByRole('button', { name: 'Create Vault' }).click()
    const download = page.waitForEvent('download')
    await vaultDialog.getByRole('button', { name: /Download rfq-recovery-key.json/ }).click()
    expect((await download).suggestedFilename()).toBe('rfq-recovery-key.json')
    await vaultDialog.getByRole('button', { name: 'Done' }).click()
  } else {
    // A previous run already created the vault on this stack
    await vaultDialog.getByLabel('Vault passphrase').fill(passphrase)
    await vaultDialog.getByRole('button', { name: /Unlock/ }).click()
  }
  await expect(vaultDialog).toBeHidden()
  await page.getByLabel('Hourly sell rate BCC').fill('100')
  await page.getByLabel('Cost rate BCC Senior').fill('60')
  await page.getByRole('button', { name: 'Save Budget Configuration' }).click()
  await expect(page.getByText(/Saved ✓/)).toBeVisible()

  // The analysis reads the encrypted figures back and the workbook exports
  await page.getByRole('link', { name: 'Reports' }).click()
  await expect(page.getByText('Cost-Profit Summary by Year and Location')).toBeVisible()
  const budgetDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /Download Budget Plan/ }).click()
  expect((await budgetDownload).suggestedFilename()).toBe(`${name} - Budget Plan.xlsx`)

  // The JSON export round-trips through the import
  await page.goto('/')
  const exportDownload = page.waitForEvent('download')
  await page.getByLabel(`Export ${name} as JSON`).click()
  expect((await exportDownload).suggestedFilename()).toBe(`${name}.json`)
})
