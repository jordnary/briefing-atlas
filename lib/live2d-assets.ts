import { CompanionLoadError } from './companion-loading';

/** Fetch essential resources with a shared cancellation boundary before GPU setup. */
export async function loadCompanionAssets(url: string, signal: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.throwIfAborted();
  signal.addEventListener('abort', cancel, { once: true });
  const blobs: string[] = [];
  const release = () => {
    signal.removeEventListener('abort', cancel);
    controller.abort();
    blobs.splice(0).forEach((blob) => URL.revokeObjectURL(blob));
  };
  const fetchResource = async (resource: string) => {
    let response: Response;
    try {
      response = await fetch(resource, { signal: controller.signal });
    } catch (error) {
      controller.signal.throwIfAborted();
      throw error instanceof SyntaxError
        ? error
        : new CompanionLoadError('network');
    }
    if (!response.ok)
      throw new CompanionLoadError(
        response.status >= 500 ||
          response.status === 408 ||
          response.status === 429
          ? 'network'
          : 'resource',
      );
    return response;
  };
  try {
    const source = await (await fetchResource(url)).json();
    const files = source?.FileReferences;
    if (
      source?.Version !== 3 ||
      !files ||
      typeof files.Moc !== 'string' ||
      !Array.isArray(files.Textures) ||
      !files.Textures.length ||
      !files.Textures.every((path: unknown) => typeof path === 'string') ||
      (files.Physics != null && typeof files.Physics !== 'string')
    )
      throw new CompanionLoadError('resource');
    const blob = async (path: string, kind: 'moc' | 'texture' | 'physics') => {
      const data = await (await fetchResource(new URL(path, url).href)).blob();
      if (kind === 'moc' && (await data.slice(0, 4).text()) !== 'MOC3')
        throw new CompanionLoadError('resource');
      if (kind === 'physics') JSON.parse(await data.text());
      if (kind === 'texture') {
        try {
          const bitmap = await createImageBitmap(data);
          bitmap.close();
        } catch {
          throw new CompanionLoadError('resource');
        }
      }
      controller.signal.throwIfAborted();
      const objectURL = URL.createObjectURL(data);
      blobs.push(objectURL);
      return objectURL;
    };
    const [moc, textures, physics] = await Promise.all([
      blob(files.Moc, 'moc'),
      Promise.all(files.Textures.map((path: string) => blob(path, 'texture'))),
      files.Physics ? blob(files.Physics, 'physics') : undefined,
    ]);
    signal.throwIfAborted();
    return {
      source: {
        ...source,
        url,
        FileReferences: {
          ...files,
          Moc: moc,
          Textures: textures,
          Physics: physics,
        },
      },
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
