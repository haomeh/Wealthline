// The single-file load and save the app once wrapped around readFile and saveDataText, for the Drive protocol tests.
export const loadData = async (drive, token, parse) => {
  const fileId = await drive.findDataFile(token)
  if (!fileId) return null
  const file = await drive.readFile(token, fileId)
  return { fileId: file.fileId, etag: file.etag, data: parse(drive.parseJson(file.text)) }
}
export const saveData = (drive, token, data, version) => drive.saveDataText(token, JSON.stringify(data, null, 2), version)
