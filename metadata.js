var xml2js = require('xml2js')
var parseString = xml2js.parseString
var fs = require('fs')
var path = require('path')
var glob = require('matched')
var exists = require('exists-file').sync
var untildify = require('untildify')
var bib = require('./bibtransform.js')
var keyworder = require(untildify('~/code/blahah/corpus-keyword-miner/index.js'))
var _ = require('lodash')
var mkdirp = require('mkdirp').sync
var vfile = require('to-vfile')

var dir = untildify('~/.sciencefair/elife_dws2')
var articlesDir = path.join(dir, 'articles')
var metaDir = path.join(dir, 'meta')
var tmpDir = path.join(dir, 'tmp')

mkdirp(dir)
mkdirp(articlesDir)
mkdirp(metaDir)
mkdirp(tmpDir)

function toBib (body) {
  var article = body.article.front[0]['article-meta'][0]
  var metadata = {
    title: parseTitle(article['title-group'][0]['article-title'][0]),
    author: parseAuthor(article['contrib-group'][0]),
    abstract: parseAbstract(article.abstract),
    identifier: parseIdentifier(article['article-id']),
    date: parseDate(article['pub-date']),
    license: parseLicense(article.permissions)
  }
  metadata.path = metadata.identifier.filter(function (id) {
    return id.type === 'publisher-id'
  })[0].id

  return metadata
}

function parseTitle (title) {
  if (typeof title === 'string') {
    return title
  } else {
    return title._
  }
}

function parseAuthor (author) {
  if (!author.contrib) return []
  return author.contrib.map(function (entry) {
    if (entry.name) {
      return {
        surname: entry.name[0].surname[0]._,
        'given-names': entry.name[0]['given-names'][0]._
      }
    } else {
      return null
    }
  }).filter(function (entry) {
    return entry != null
  })
}

function buildXML (parts) {
  return parts.map(function (part) {
    if (part['#name'] === '__text__') {
      return part._
    } else {
      return `<${part['#name']}>${part._}</${part['#name']}>`
    }
  }).join('')
}

function parseAbstract (abstract) {
  if (abstract && abstract.length > 0 && abstract[0].p) {
    return buildXML(abstract[0].p[0].$$)
  }
  return null
}

function parseIdentifier (ids) {
  return ids.map(function (id) {
    return {
      type: id.$['pub-id-type'],
      id: id._
    }
  })
}

function parseDate (date) {
  return {
    day: date[0].day[0]._,
    month: date[0].month[0]._,
    year: date[0].year[0]._
  }
}

function parseLicense (permissions) {
  if (permissions[0].license[0]) {
    return permissions[0].license[0].$['xlink:href']
  }
}

console.log('generating metadata')

var dirs = glob.sync(['articles/*'], { cwd: dir })
var articles = []
dirs.forEach(function (article) {
  var articledir = path.join(dir, article)
  if (/xml$/.test(article)) {
    articles.push(articledir)
    return
  }
  var xmlfiles = glob.sync(['*.xml'], { cwd: articledir })
  if (xmlfiles.length === 0) return
  // only use the laest version
  var xmlfile = xmlfiles.sort()[xmlfiles.length - 1]
  articles.push(path.join(articledir, xmlfile))
})

function stripVersion (a) {
  return a.split(/v[0-9]/).join('')
}

// make sure we only have the latest version
articles = _.map(_.groupBy(articles, stripVersion), function (vs) {
  return vs.sort()[vs.length - 1]
}).slice(0, 100)

console.log('Running keyword extraction for', articles.length, 'articles')

function mineKeywords () {
  var keywords = []

  var done = _.after(articles.length, function (err) {
    if (err) throw err

    var n = articles.length

    var alldfs = _.countBy(keywords)

    console.log('Found', Object.keys(alldfs).length, 'words in', n, 'articles')

    var alldfjson = path.join(tmpDir, 'alldfs.json')
    fs.writeFileSync(alldfjson, JSON.stringify(alldfs, null, 2), 'utf8')

    var idfs = {}

    _.forEach(alldfs, function (value, key) {
      idfs[key] = Math.log(n / value)
    })

    var idfjson = path.join(tmpDir, 'idfs.json')
    fs.writeFileSync(idfjson, JSON.stringify(idfs, null, 2), 'utf8')

    console.log('Wrote IDF for', Object.keys(idfs).length, 'words to', idfjson)

    calculateTFDF()

    mineMetadata(idfs)
  })

  var getkeywords = keyworder.use(function () {
    return function (tree, file) {
      var space = file.namespace('retext')
      var all = space.keywords
        .map(function (p) { return p.stem })
        .concat(space.keyphrases.map(function (p) { return p.value }))
      // add to corpus keywords
      keywords = keywords.concat(_.uniq(all))
      var savepath = path.join(tmpDir, file.filename + '.keywords.json')
      fs.writeFileSync(savepath, space.keywords.concat(space.keyphrases))
    }
  })

  // count number of documents each word occurs in
  articles.forEach(function (xmlfile) {
    getkeywords.process(vfile(xmlfile), function (err, file) {
      if (err) throw err
      done()
    })
  })
}

function calculateTFDF () {
  articles.forEach()
}

function mineMetadata (idfs) {
  var n = 0

  articles.forEach(function (xmlfile) {
    var parts = path.parse(xmlfile)
    var json = path.join(dir, 'meta', parts.name + '.json')
    if (!exists(json)) {
      n += 1
      var xml = fs.readFileSync(xmlfile, 'utf8')
      parseString(xml, {
        charsAsChildren: true,
        explicitChildren: true,
        preserveChildrenOrder: true
      }, function (err, body) {
        if (err) throw err
        if (body.article) {
          fs.writeFileSync(json, JSON.stringify(toBib(body)))
          console.log('wrote', json)
        } else {
          console.log('error: malformed XML in file', xmlfile)
        }
      })
    }
  })

  if (n === 0) {
    console.log('nothing to do - all XML files have a matching JSON')
  } else {
    console.log('generated', n, 'metadata JSON files')
  }
}

mineKeywords()
