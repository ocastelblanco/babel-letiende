import { PvpPipe } from './pvp.pipe';

describe('PvpPipe', () => {
  it('formatea con $ y punto como separador de miles, sin decimales', () => {
    const pipe = new PvpPipe();

    expect(pipe.transform(45000)).toBe('$45.000');
    expect(pipe.transform(1200000)).toBe('$1.200.000');
    expect(pipe.transform(0)).toBe('$0');
  });
});
