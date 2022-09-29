import aws from '@aws-sdk/client-ecr'
import { Octokit } from 'octokit'
import yaml from 'js-yaml'

const OWNER = 'integration-app'
const REPO = 'helm'

const application = process.argv[2]

const ecr = new aws.ECR({})
const octokit = new Octokit({ auth: process.env.GH_TOKEN })

async function run() {
  const tag = `production-${Date.now()}`

  await retagImage(application, tag)
  await updateImageTagInHelm(`charts/${application}/prod-values.yaml`, tag)
}

run().then(() => {
  console.log('Done')
  process.exit(0)
}).catch((e) => {
  console.error(e)
  process.exit(1)
})


async function retagImage(repositoryName, tag) {
  const getImageParams = { repositoryName, imageIds: [{ imageTag: 'latest' }] }

  const getResult = await ecr.batchGetImage(getImageParams)

  if (getResult.failures.length > 0) {
    const failure = getResult.failures[0]
    console.error(`${failure.failureCode}: ${failure.failureReason} for tag ${failure.imageId.imageTag}`)
    process.exit(1)
  }

  let getImage = getResult.images[0]
  console.debug(`Image found: ${getImage.repositoryName}:${getImage.imageId.imageTag}`)

  const putResult = await ecr.putImage(
    {
      registryId: getImage.registryId,
      repositoryName: getImage.repositoryName,
      imageManifest: getImage.imageManifest,
      imageTag: tag,
    }
  )
  const putImage = putResult.image
  console.debug(`Image tagged: ${putImage.repositoryName}:${putImage.imageId.imageTag}`)
}

async function updateImageTagInHelm(path, tag) {
  const response = await octokit.rest.repos.getContent({
    owner: 'integration-app',
    repo: 'helm',
    path: path,
  })
  const content = Buffer.from(response.data.content, 'base64').toString()
  const data = yaml.load(content)
  data.image.tag = tag
  const updatedContent = yaml.dump(data)
  await updateFile(path, Buffer.from(updatedContent).toString('base64'), `Update ${path} to prod image tag`)
}


async function updateFile(path, content, message) {
  const sha = await getSHA(path);

  await octokit.rest.repos.createOrUpdateFileContents({
    owner: OWNER,
    repo: REPO,
    path,
    message,
    content,
    sha,
  });
}

async function getSHA(path) {
  const result = await octokit.rest.repos.getContent({
    owner: OWNER,
    repo: REPO,
    path,
  });

  const sha = result.data.sha;

  return sha
}
