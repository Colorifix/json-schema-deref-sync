const fs = require('fs')
const path = require('path')
const jsyaml = require('js-yaml')

const { getRefFilePath } = require('../lib/utils')
const baseFileLoader = require('../lib/loaders/file')

const processCwd = process.cwd()

const file = {
  ...baseFileLoader,
  load: (loader, refValue, options) => {
    let refPath = refValue
    const baseFolder = (options && options.baseFolder) ? path.resolve(processCwd, options.baseFolder) : processCwd

    if (refPath.indexOf('file:') === 0) {
      refPath = refPath.substring(5)
    } else {
      refPath = path.resolve(baseFolder, refPath)
    }

    const filePath = getRefFilePath(refPath)

    let newValue
    try {
      var data = fs.readFileSync(filePath, 'utf8')
      newValue = jsyaml.load(data)
    } catch (e) {}

    return newValue
  }
}
module.exports.file = file
