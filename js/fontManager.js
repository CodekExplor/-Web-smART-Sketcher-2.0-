let nextFontId = 1;

export async function listLocalFonts(query) {
  if (typeof query !== 'function') throw new Error('Ta przeglądarka nie udostępnia listy czcionek. Wczytaj plik czcionki z komputera.');
  let fonts;
  try { fonts = await query(); }
  catch { throw new Error('Nie uzyskano dostępu do czcionek z komputera. Możesz wczytać plik czcionki.'); }
  return fonts.filter(font => font.postscriptName && font.fullName && typeof font.blob === 'function')
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'pl'));
}

export async function loadFont(source, { FontFaceClass = FontFace, fontSet = document.fonts } = {}) {
  if (!source || typeof source.arrayBuffer !== 'function') throw new Error('Nie można odczytać czcionki.');
  const alias = `SketcherUserFont${nextFontId++}`;
  let face;
  try {
    face = new FontFaceClass(alias, await source.arrayBuffer());
    await face.load();
    fontSet.add(face);
  } catch { throw new Error('Nie można wczytać tej czcionki. Wybierz plik TTF, OTF, WOFF lub WOFF2.'); }
  return { face, css: `"${alias}", sans-serif` };
}

export function validateFontFile(file) {
  if (!file || !/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('Wybierz plik czcionki TTF, OTF, WOFF lub WOFF2.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Plik czcionki jest zbyt duży (maksymalnie 20 MB).');
  return file;
}
