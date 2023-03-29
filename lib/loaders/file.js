const fs = require('fs')
const path = require('path')
const { getRefPathValue, getRefFilePath } = require('../utils')
const { derefSchema } = require('../index')

const processCwd = process.cwd()
const isWindows = process.platform === 'win32'

// Regex to split a windows path into three parts: [*, device, slash,
// tail] windows-only
const splitDeviceRe = /^([a-zA-Z]:|[\\\/]{2}[^\\\/]+[\\\/]+[^\\\/]+)?([\\\/])?([\s\S]*?)$/

function win32StatPath (path) {
  const result = splitDeviceRe.exec(path)
  const device = result[1] || ''
  const isUnc = !!device && device[1] !== ':'

  return {
    device: device,
    isUnc: isUnc,
    isAbsolute: isUnc || !!result[2], // UNC paths are always absolute
    tail: result[3]
  }
}

const isAbsolute = typeof path.isAbsolute === 'function' ? path.isAbsolute : function utilIsAbsolute (path) {
  if (isWindows) {
    return win32StatPath(path).isAbsolute
  }
  return !!path && path[0] === '/'
}

const getCwdFromOptions = ({ baseFolder }) => {
  if (!baseFolder){
    return processCwd
  }
  if (!isAbsolute(baseFolder)) {
    return path.resolve(processCwd, baseFolder)
  }
  return baseFolder
}

/**
 * Resolves a file link of a json schema to the actual value it references
 * @param refValue the value. String. Ex. `/some/path/schema.json#/definitions/foo`
 * @param options
 *              baseFolder - the base folder to get relative path files from. Default is `process.cwd()`
 * @returns {*}
 * @private
 */
module.exports = {
  getRefSchema: (loader, refVal, refType, parent, options, state) => {
    let newVal
    let oldBasePath
    let loaderValue
    let filePath
    let fullRefFilePath

    const cache = state.cache || {}

    if (!state.cache) {
      state.cache = cache
    }

    const cwd = state.cwd || getCwdFromOptions(options)

    // First, see if we've already cached the contents of the file.
    // If so, set loaderValue to the contents of the file.
    if (refType === 'file') {
      filePath = getRefFilePath(refVal)
      fullRefFilePath = (
        isAbsolute(filePath)
          ? filePath
          : path.resolve(cwd, filePath)
      )

      if (cache[fullRefFilePath]) {
        loaderValue = cache[fullRefFilePath]
      }
    }

    // If we haven't found the file in the cache, load it, dereference it,
    // and store the result in loaderValue.
    if (!loaderValue) {
      loaderValue = loader.load(loader, refVal, options)
      if (loaderValue) {
        // adjust base folder if needed so that we can handle paths in nested folders
        if (refType === 'file') {
          let dirname = path.dirname(filePath)
          if (dirname === '.') {
            dirname = ''
          }

          if (dirname) {
            oldBasePath = cwd
            const newBasePath = path.resolve(cwd, dirname)
            options.baseFolder = newBasePath
          }
        }

        loaderValue = derefSchema(loaderValue, options, state)

        // reset
        if (oldBasePath) {
          options.baseFolder = state.cwd = oldBasePath
        }
      }
    }

    if (loaderValue) {
      // If we have found the file, but the contents are not in the cache,
      // update the cache.
      if (refType === 'file' && fullRefFilePath && !cache[fullRefFilePath]) {
        cache[fullRefFilePath] = loaderValue
      }

      // If the value includes a #, it indicates a path within the file, so
      // we will only actually return that part, not the whole file.
      if (refVal.indexOf('#') >= 0) {
        const refPaths = refVal.split('#')
        const refPath = refPaths[1]
        const refNewVal = getRefPathValue(loaderValue, refPath)
        if (refNewVal) {
          newVal = refNewVal
        }
      } else {
        newVal = loaderValue
      }
    }
    return newVal
  },
  load: (loader, refValue, options) => {
    let refPath = refValue
    const baseFolder = (
      (options && options.baseFolder)
        ? path.resolve(processCwd, options.baseFolder)
        : processCwd
    )

    if (refPath.indexOf('file:') === 0) {
      refPath = refPath.substring(5)
    } else {
      refPath = path.resolve(baseFolder, refPath)
    }

    const filePath = getRefFilePath(refPath)

    let newValue
    try {
      var data = fs.readFileSync(filePath)
      newValue = JSON.parse(data)
    } catch (e) {}

    return newValue
  }
}
