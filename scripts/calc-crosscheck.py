"""
Independent re-implementation of the PRECEPTOR calculators, used to produce
the expected values in tests/calc/fixtures.ts (origin "independent").

It is written from the published formulas, not from the TypeScript code, and
prints every fixture's expected value with full precision. Run:

    python3 -I scripts/calc-crosscheck.py
"""
import math

def bmi(kg, cm): return kg / (cm / 100) ** 2
def bsa(cm, kg): return math.sqrt(cm * kg / 3600)
def ibw(cm, female): return (45.5 if female else 50) + 2.3 * (cm / 2.54 - 60)
def adjbw(cm, female, tbw, f): i = ibw(cm, female); return i + f * (tbw - i)
def cg(age, kg, scr_mgdl, female): v = (140 - age) * kg / (72 * scr_mgdl); return v * 0.85 if female else v
def ckdepi2021(age, scr, female):
    k = 0.7 if female else 0.9; a = -0.241 if female else -0.302
    return 142 * min(scr / k, 1) ** a * max(scr / k, 1) ** -1.2 * 0.9938 ** age * (1.012 if female else 1)
def bazett(qt, hr): return qt / math.sqrt(60 / hr)
def fridericia(qt, hr): return qt / (60 / hr) ** (1 / 3)
def ag(na, cl, hco3): return na - (cl + hco3)
def ag_corr(na, cl, hco3, alb): return ag(na, cl, hco3) + 2.5 * (4.0 - alb)
def ca_corr(ca_mgdl, alb): return ca_mgdl + 0.8 * (4.0 - alb)
def pht(c, alb, renal): return c / ((0.1 if renal else 0.2) * alb + 0.1)
def anc(wbc, neut, bands=0): return wbc * (neut + bands) / 100

def vanco(dose, tinf, tau, t_start, c1, t1, c2, t2):
    """Times in hours from an arbitrary origin."""
    end = t_start + tinf; nxt = t_start + tau
    ke = math.log(c1 / c2) / (t2 - t1)
    cmax = c1 * math.exp(ke * (t1 - end)); cmin = c2 * math.exp(-ke * (nxt - t2))
    d = math.exp(-ke * tinf)
    v = (dose / tinf) * (1 - d) / (ke * (cmax - cmin * d))
    cl = ke * v
    return dict(ke=ke, half=math.log(2) / ke, cmax=cmax, cmin=cmin, v=v, cl=cl, auc24=dose * 24 / tau / cl)

def simulate(cl, v, dose, tinf, tau, t):
    """Steady-state concentration t hours after the start of an infusion (one compartment)."""
    ke = cl / v; r0 = dose / tinf
    acc = 1 / (1 - math.exp(-ke * tau))
    if t <= tinf:
        # infusion phase at steady state: residual from previous doses + current infusion
        cmin = r0 / cl * (1 - math.exp(-ke * tinf)) * math.exp(-ke * (tau - tinf)) * acc
        return cmin * math.exp(-ke * t) + r0 / cl * (1 - math.exp(-ke * t))
    cmax = r0 / cl * (1 - math.exp(-ke * tinf)) * acc
    return cmax * math.exp(-ke * (t - tinf))

def auc_numeric(cl, v, dose, tinf, tau, n=200000):
    h = tau / n
    s = 0.5 * (simulate(cl, v, dose, tinf, tau, 0) + simulate(cl, v, dose, tinf, tau, tau))
    for i in range(1, n): s += simulate(cl, v, dose, tinf, tau, i * h)
    return s * h * 24 / tau

P = lambda name, x: print(f"{name:55s} {x!r}")
print("--- body")
P("bmi 70kg 175cm", bmi(70, 175)); P("bmi 45kg 160cm", bmi(45, 160)); P("bmi 95kg 170cm", bmi(95, 170))
P("bsa 175cm 70kg", bsa(175, 70)); P("bsa 160cm 50kg", bsa(160, 50))
P("ibw M 175", ibw(175, False)); P("adjbw M 175 tbw100 f0.4", adjbw(175, False, 100, 0.4)); P("pctIbw", 100 / ibw(175, False) * 100)
P("ibw F 165", ibw(165, True)); P("adjbw F 165 tbw60 f0.4", adjbw(165, True, 60, 0.4)); P("ibw F 150", ibw(150, True))
print("--- renal")
P("cg M60 70kg 1.2", cg(60, 70, 1.2, False)); P("cg F60 70kg 1.2", cg(60, 70, 1.2, True))
P("cg M60 70kg 106.08umol", cg(60, 70, 106.08 / 88.4, False))
P("cg M50 IBW(175) 1.0", cg(50, ibw(175, False), 1.0, False)); P("cg M50 AdjBW(175,100,0.4) 1.0", cg(50, adjbw(175, False, 100, 0.4), 1.0, False))
P("cg M50 TBW100 1.0", cg(50, 100, 1.0, False)); P("bmi 100kg 175", bmi(100, 175))
P("ckdepi F50 0.6", ckdepi2021(50, 0.6, True)); P("ckdepi M60 1.2", ckdepi2021(60, 1.2, False)); P("ckdepi F70 1.1", ckdepi2021(70, 1.1, True))
P("ckdepi F70 97.24umol", ckdepi2021(70, 97.24 / 88.4, True)); P("ckdepi M40 0.9 (kink)", ckdepi2021(40, 0.9, False)); P("ckdepi F40 0.7 (kink)", ckdepi2021(40, 0.7, True))
print("--- qtc")
for qt, hr in [(400, 60), (360, 100), (440, 50)]: P(f"bazett {qt}/{hr}", bazett(qt, hr)); P(f"fridericia {qt}/{hr}", fridericia(qt, hr))
print("--- electrolytes")
P("ag 140/104/24", ag(140, 104, 24)); P("ag 140/100/20", ag(140, 100, 20)); P("agcorr alb2.0", ag_corr(140, 100, 20, 2.0))
P("ca 8.0 alb2.0", ca_corr(8.0, 2.0)); P("ca 8.0 alb2.0 mmol", ca_corr(8.0, 2.0) / 4.008)
P("ca 2.0mmol alb20gL", ca_corr(2.0 * 4.008, 2.0)); P("ca 2.0mmol alb20gL mmol", ca_corr(2.0 * 4.008, 2.0) / 4.008); P("ca 10 alb4.5", ca_corr(10.0, 4.5))
print("--- phenytoin")
P("pht 8 alb2.0", pht(8, 2.0, False)); P("pht 8 alb2.0 renal", pht(8, 2.0, True)); P("pht 31.712umol alb2.0", pht(31.712 / 3.964, 2.0, False))
P("pht 10 alb3.0", pht(10, 3.0, False)); P("pht 6 alb1.8", pht(6, 1.8, False)); P("pht 12 alb4.5", pht(12, 4.5, False))
print("--- anc")
P("anc 5.0 60 5", anc(5.0, 60, 5)); P("anc 1.2 30", anc(1.2, 30))
print("--- vancomycin")
h = vanco(1000, 1.5, 12, 0, 17.0, 2.5, 4.1, 12.0)
for k, x in h.items(): P(f"herman {k}", x)
for (cl, v, dose, tinf, tau, a, b) in [(4, 50, 1250, 1, 12, 2, 11.5), (2, 40, 1500, 1.5, 12, 2.5, 11.5), (5, 60, 1250, 1, 12, 2, 11.5), (3, 70, 1000, 1, 8, 2.5, 7.5)]:
    c1 = simulate(cl, v, dose, tinf, tau, a); c2 = simulate(cl, v, dose, tinf, tau, b)
    r = vanco(dose, tinf, tau, 0, c1, a, c2, b)
    P(f"sim CL{cl} V{v} D{dose} tinf{tinf} tau{tau}: c1", c1); P("   c2", c2)
    P("   recovered V", r["v"]); P("   recovered CL", r["cl"]); P("   auc24", r["auc24"]); P("   cmin", r["cmin"]); P("   numeric auc24", auc_numeric(cl, v, dose, tinf, tau, 20000))
