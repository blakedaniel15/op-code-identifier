import { runEval, serviceNameToExpected } from './harness';

test('serviceNameToExpected maps no-service to null and passes real names through', () => {
  expect(serviceNameToExpected('No services')).toBeNull();
  expect(serviceNameToExpected('  ')).toBeNull();
  expect(serviceNameToExpected('Fuel Service')).toBe('Fuel Service');
});

test('tier-1 (Deacon Jones) meets the accuracy bar', async () => {
  const m = await runEval({
    csvPath: 'eval/fixtures/deacon_jones.csv',
    fixturePath: 'eval/ground-truth/deacon_jones.json',
  });
  expect(m.identification).toBeGreaterThanOrEqual(0.9);
  expect(m.falsePositive).toBeLessThanOrEqual(0.02);
});
