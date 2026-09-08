// Run only after deploy-pages succeeds, under the shared Pages concurrency group.
export async function cleanupPagesDeployments({ github, context, core }) {
  const environment = 'github-pages';
  const repo = context.repo;
  // Collect every page before deleting, so pagination cannot skip old records.
  const deployments = (
    await github.paginate(github.rest.repos.listDeployments, {
      ...repo,
      environment,
      per_page: 100,
    })
  )
    .filter((deployment) => deployment.environment === environment)
    .sort((a, b) => b.id - a.id);
  const latest = deployments[0];
  if (!latest || latest.sha !== context.sha) {
    throw new Error(
      'Latest Pages deployment does not match this workflow commit.',
    );
  }
  const { data: statuses } = await github.rest.repos.listDeploymentStatuses({
    ...repo,
    deployment_id: latest.id,
    per_page: 1,
  });
  if (statuses[0]?.state !== 'success') {
    throw new Error(
      'Latest Pages deployment is not successful; cleanup stopped.',
    );
  }

  let deleted = 0;
  for (const deployment of deployments.slice(1)) {
    // GitHub requires an inactive status before deleting an old deployment.
    await github.rest.repos.createDeploymentStatus({
      ...repo,
      deployment_id: deployment.id,
      state: 'inactive',
      auto_inactive: false,
      description: 'Superseded by the latest successful Pages deployment.',
    });
    await github.rest.repos.deleteDeployment({
      ...repo,
      deployment_id: deployment.id,
    });
    deleted += 1;
  }
  core.info(
    `Retained the latest successful Pages deployment; removed ${deleted} old records.`,
  );
  return { retained: latest.id, deleted };
}
