/* eslint no-restricted-globals: 0, prefer-spread: 0 */
/* global self */
// self.importScripts(['/static/libs/typescript.min.js']);
self.importScripts(['/static/libs/prism.min.js']);

function getLineNumberAndOffset(start, lines) {
  let line = 0;
  let offset = 0;
  while (offset + lines[line] < start) {
    offset += lines[line] + 1;
    line += 1;
  }

  return { line: line + 1, offset };
}

function tagType(token) {
  try {
    if (token.content[0].content[0].content === '</') return 'end';
  } catch (e) {}

  const last = token.content[token.content.length - 1];
  if (last.content === '>') return 'start';
  if (last.content === '/>') return 'self-close';
  return null;
}

function findJsxText(tokens) {
  let jsxDepth = 0;
  let jsxExpDepth = 0;
  let jsxTextToken = null;
  const result = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'tag') {
      const tt = tagType(t);
      result.push(t);
      if (tt === 'start') {
        jsxDepth += 1;
        jsxTextToken = { content: '', type: 'jsx-text', length: 0 };
        result.push(jsxTextToken);
      }
      if (tt === 'end') {
        // if (jsxTextToken.length > 0) result.push(jsxTextToken);
        jsxDepth -= 1;
        if (jsxDepth < 0) jsxDepth = 0;
        if (jsxDepth === 0) jsxTextToken = null;
        else {
          jsxTextToken = { content: '', type: 'jsx-text', length: 0 };
          result.push(jsxTextToken);
        }
      }
      if (tt === 'self-close' && jsxDepth > 0) {
        jsxTextToken = { content: '', type: 'jsx-text', length: 0 };
        result.push(jsxTextToken);
      }
      continue; // eslint-disable-line
    }

    // Find jsx expression
    if (t.content === '{') {
      jsxExpDepth += 1;
      if (jsxExpDepth === 1) {
        result.push({
          ...t,
          type: 'jsx-exp-start',
        });
        jsxTextToken = null;
        continue; // eslint-disable-line
      }
    }
    if (t.content === '}') {
      jsxExpDepth -= 1;
      if (jsxExpDepth < 0)jsxExpDepth = 0;
      if (jsxExpDepth === 0) {
        result.push({
          ...t,
          type: 'jsx-exp-end',
        });

        if (jsxDepth > 0) {
          jsxTextToken = { content: '', type: 'jsx-text', length: 0 };
          result.push(jsxTextToken);
        }
        continue; // eslint-disable-line        
      }
    }

    if (jsxTextToken) {
      jsxTextToken.length += t.length;
      jsxTextToken.content += typeof t === 'string' ? t : t.content;
    } else {
      result.push(t);
    }
  }
  return result;
}

// let jsxContext = [];
function flattenToken(token) {
  if (!Array.isArray(token.content)) return [token];

  const isEndTag = token.content[0].content[0].content === '</';
  if (isEndTag) {
    return [
      {
        type: 'end-tag-start',
        content: '</',
        length: 2,
      },
      {
        type: 'end-tag-name',
        content: token.content[0].content[1],
        length: token.content[0].content[1].length,
      },
      ...token.content.slice(1, token.content.length - 1),
      {
        type: 'end-tag-end',
        content: '>',
        length: 1,
      },
    ];
  }

  let arr = [...token.content];
  const result = [];
  while (arr.length) {
    const t = arr.shift();
    if (/attr-name|attr-value/.test(t.type)) result.push(t);
    else if (/spread/.test(t.type)) {
      result.push({
        ...t.content[0],
        type: 'jsx-exp-start',
      });
      result.push.apply(result, t.content.slice(1, t.content.length - 1));
      result.push({
        ...t.content[t.content.length - 1],
        type: 'jsx-exp-end',
      });
    } else if (t.type === 'script') {
      const i = t.content.findIndex(c => c.content === '{');
      result.push.apply(result, [
        ...t.content.slice(0, i),
        {
          ...t.content[i],
          type: 'jsx-exp-start',
        },
        ...t.content.slice(i + 1, t.content.length - 1),
        {
          ...t.content[t.content.length - 1],
          type: 'jsx-exp-end',
        },
      ]);
    } else if (Array.isArray(t.content)) arr = [...t.content, ...arr];
    else result.push(t);
  }
  result[0].type = 'tag-start';
  result[1] = {
    type: 'start-tag-name',
    length: result[1].length,
    content: result[1],
  };
  result[result.length - 1].type = 'tag-end';
  return result;
}

// Respond to message from parent thread
self.addEventListener('message', event => {
  const { code } = event.data;
  try {
    // jsxContext = [];
    let tokens = Prism.tokenize(code, Prism.languages.jsx);
    console.log(tokens);
    tokens = findJsxText(tokens);
    tokens = tokens.reduce((prev, t) => {
      if (t.type === 'tag') {
        prev.push.apply(prev, flattenToken(t)); // eslint-disable-line
        return prev;
      }
      prev.push(t);
      return prev;
    }, []);

    const classifications = [];
    let pos = 0;
    const lines = code.split('\n').map(line => line.length);
    tokens.forEach(token => {
      if (typeof token === 'string') {
        if (token === 'console') {
          token = {
            content: 'console',
            type: 'globals',
            length: 7,
          };
        } else {
          pos += token.length;
          return;
        }
      }

      const { offset: startOffset, line: startLine } = getLineNumberAndOffset(pos, lines);
      const { offset: endOffset, line: endLine } = getLineNumberAndOffset(pos + token.length, lines);
      let kind = token.type;
      if (kind === 'keyword') kind = `${token.content}-keyword`;
      if (token.content === 'constructor' && token.type === 'function') kind = 'constructor-keyword';
      if (token.content === '=>') kind = 'arrow-operator';
      classifications.push({
        start: pos + 1 - startOffset,
        end: pos + 1 + token.length - endOffset,
        kind,
        startLine,
        endLine,
      });
      pos += token.length;
    });
    self.postMessage({ classifications });
  } catch (e) {
    /* Ignore error */
  }
});