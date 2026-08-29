# UST Font Files

Place licensed web-font files in this folder. Prefer WOFF2 files, for example:

- `USTSans-Regular.woff2`
- `USTSans-Bold.woff2`

Then add the following near the top of `styles.css` and use `"UST Sans"` in the appropriate `font-family` declaration:

```css
@font-face {
  font-family: "UST Sans";
  src: url("/fonts/USTSans-Regular.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: "UST Sans";
  src: url("/fonts/USTSans-Bold.woff2") format("woff2");
  font-style: normal;
  font-weight: 700 900;
  font-display: swap;
}
```

Do not redistribute an official university font unless its license permits inclusion in the project.
