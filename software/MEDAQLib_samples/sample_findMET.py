############################################################################
# sample_findMET.py
# Jochen Kunz, JKu
# 26.11.2026 Initial
# Stand: 27.11.26
############################################################################

import sys
import os
import time
import re
import winsound

from enum import Enum
from datetime import datetime
from time import sleep
from MEDAQLib import MEDAQLib, ME_SENSOR, ERR_CODE

VERSION = "V0.01"

global gsOutString
gsOutString = ""
global gDayTimes
gDayTimes = {}
global MEDAQLib_object
global glRound
glRound = 1
sep = ";"


COLOR_RESET  = "\033[0m"
COLOR_GREEN  = "\033[92m"
COLOR_YELLOW = "\033[93m"
COLOR_RED    = "\033[91m"

class State(Enum):
  DEF = 0

STATE_TEXT = {
  State.DEF: "DEFAULT",
}

INITFILE = 'metcalib.ini'
Verbose = 0


############################################################################
# Progress in Pacman Style                                                #
############################################################################
class PacmanProgress:
    def __init__(self, total, width=40, cookie_spacing=3, text="Status"):
        self.total = total
        self.width = width
        self.cookie_spacing = cookie_spacing
        self.text = text

        self.cookie_positions = {
            i for i in range(width) if i % cookie_spacing == 0
        }

    def update(self, current):
        ratio = min(current / self.total, 1.0)
        pos = int(ratio * self.width)

        pacman = "C" if current % 2 == 0 else "c"
        bar_chars = []

        for i in range(self.width):
            if i < pos:
                bar_chars.append("-")
            elif i == pos:
                bar_chars.append(pacman)
            elif i in self.cookie_positions:
                bar_chars.append("o")
            else:
                bar_chars.append(" ")

        percent = int(ratio * 100)

        sys.stdout.write(
            f"\r[{''.join(bar_chars)}] {percent:3d}%  {self.text}"
        )
        sys.stdout.flush()

    def finish(self):
        self.update(self.total)
        print()

#
############################################################################


############################################################################
# parameterfile einlesen                                                  #
############################################################################
def read_parameters(filename):
  params = {}

  with open(filename, "r", encoding="utf-8") as f:
    for line in f:
      line = line.strip()

      if not line or line.startswith("#"):
        continue

      if "=" in line:
        key, value = line.split("=", 1)
        params[key.strip()] = value.strip()
        if Verbose >= 1:
          print(f"read_parameters: {key} = {value}")

  return params

#
############################################################################



############################################################################
# Messparameter fuer Live-Anzeige                                         #
############################################################################
def read_measurement_config(config):
  if 'measurement' not in config:
    raise ValueError("Abschnitt [measurement] fehlt in metcalib.ini")

  try:
    display_duration_sec = int(config['measurement']['display_duration_sec'])
    display_interval_sec = float(config['measurement']['display_interval_sec'].replace(',', '.'))
  except KeyError as e:
    raise ValueError(f"Fehlender Parameter in [measurement]: {e}")
  except ValueError:
    raise ValueError("Parameter in [measurement] sind ungueltig")

  if display_duration_sec <= 0:
    raise ValueError("display_duration_sec muss > 0 sein")
  if display_interval_sec <= 0:
    raise ValueError("display_interval_sec muss > 0 sein")

  return display_duration_sec, display_interval_sec

#
############################################################################






############################################################################
# Emissionsgrad eingeben                                                  #
############################################################################
def enterEmissionsgrad(e_Pyro):
  print(f"Emmissionsgrad = {e_Pyro}")

  eingabeStr = "1.0"
  eingabeStr = eingabeStr.replace(",", ".")

  if eingabeStr == "":
    eingabeStr = e_Pyro
  else:
    try:
      e_neu = float(eingabeStr)
      print(f"nehme Emissionsgrad: {e_neu}")
    except ValueError:
      print("wrong input ...")
      eingabeStr = str(e_Pyro)

  return eingabeStr

#
############################################################################


############################################################################
# die MEDAQLib initialisieren                                             #
############################################################################
def initMEDAQLib():

  MEDAQLib_object.SetParameterInt("IP_EnableLogging", 1)

  MEDAQLib_object.ExecSCmd("Start_FindSensor")

  IA_Found = 0
  IA_Progress = 0.0

  progress = PacmanProgress(
    total=100,
    width=40,
    cookie_spacing=4,
    text="Status"
  )

  while IA_Found < 1 and IA_Progress < 100:
    MEDAQLib_object.ExecSCmd("Get_FindSensorProgress")
    IA_Found = MEDAQLib_object.GetParameterInt("IA_Found")
    IA_Progress = MEDAQLib_object.GetParameterDouble("IA_Progress")
    progress.update(IA_Progress * 10)

  if IA_Found > 0:
    progress.update(100)
    print()

    MEDAQLib_object.ExecSCmd("Abort_FindSensor")

    MEDAQLib_object.SetParameterInt("IP_Index", 0)
    MEDAQLib_object.ExecSCmd("Get_FoundSensor")

    _ = MEDAQLib_object.GetParameterInt("IP_Index")
    _ = MEDAQLib_object.GetParameterInt("IP_SensorAddress")
    _ = MEDAQLib_object.GetParameterInt("IP_SensorType")
    _ = MEDAQLib_object.GetParameterString("IP_SensorTypeName")

  MEDAQLib_object.OpenSensor()

  if MEDAQLib_object.GetLastError() == ERR_CODE.ERR_NOERROR:
    MEDAQLib_object.ExecSCmd('Get_TransmittedDataInfo')
    result = MEDAQLib_object.GetParameters(10000)

    raw_names = re.findall(r'IA_Scaled_Name(\d+)="([^"]+)"', result)
    names = [re.sub(r'\([^)]*\)', '', name) for index, name in raw_names]

    print('- '.join(names))
    print()
  else:
    print(MEDAQLib_object.GetError())
    winsound.Beep(500, 1000)

#
############################################################################


############################################################################
# Variablen vorbelegen                                                    #
############################################################################
def initVariables():
  nase = 0
  _ = nase

#
############################################################################


############################################################################
# einen ME-Bus Parameter setzen                                           #
############################################################################
def setParameterID(ID, value):
  print(f"setParamterID {ID} - {value}\n")

  MEDAQLib_object.SetParameterInt("SP_ParameterID", ID)
  MEDAQLib_object.SetParameterString("SP_Value", value)
  MEDAQLib_object.ExecSCmd("Set_ConfigParameter")

  if MEDAQLib_object.GetLastError() != ERR_CODE.ERR_NOERROR:
    winsound.Beep(500, 1000)
    print(MEDAQLib_object.GetError())
    return -1

  return 0

#
############################################################################


############################################################################
# Get_ControllerInfo                                                      #
############################################################################
def readControllerInfo():
  MEDAQLib_object.ExecSCmd("Get_ControllerInfo")
  global gsOutString

  if MEDAQLib_object.GetLastError() != ERR_CODE.ERR_NOERROR:
    print(MEDAQLib_object.GetError())
    winsound.Beep(500, 1000)
  else:
    value = MEDAQLib_object.GetParameterString("SA_ArticleNumber")
    print(f'SA_ArticleNumber = {value}')
    gsOutString = gsOutString + f'{value}{sep}'

    value = MEDAQLib_object.GetParameterString("SA_BoardArticleNumber")
    gsOutString = gsOutString + f'{value}{sep}'

    value = MEDAQLib_object.GetParameterString("SA_ControllerName")
    print(f'SA_ControllerName = {value}')
    gsOutString = gsOutString + f'{value}{sep}'

    value = MEDAQLib_object.GetParameterString("SA_SerialNumber")
    print(f'SA_SerialNumber = {value}')
    gsOutString = gsOutString + f'{value}{sep}'

    value = MEDAQLib_object.GetParameterString("SA_Option")
    print(f'SA_Option = {value}')
    gsOutString = gsOutString + f'{value}{sep}'

    value = MEDAQLib_object.GetParameterString("SA_Softwareversion")
    print(f'SA_Softwareversion = {value}')
    gsOutString = gsOutString + f'{value}{sep}'

    value = MEDAQLib_object.GetParameterString("SA_Bootloaderversion")
    print(f'SA_Bootloaderversion = {value}')
    gsOutString = gsOutString + f'{value}{sep}'

#
############################################################################


############################################################################
# einen ME-Bus Parameter lesen                                            #
############################################################################
def readParameterID(ID):
  value = ""

  MEDAQLib_object.SetParameterInt("SP_ParameterID", ID)
  MEDAQLib_object.ExecSCmd("Get_ConfigParameter")

  if MEDAQLib_object.GetLastError() != ERR_CODE.ERR_NOERROR:
    print(MEDAQLib_object.GetError())
    winsound.Beep(500, 1000)
  else:
    value = MEDAQLib_object.GetParameterString("SA_Value")

  return value

#
############################################################################


############################################################################
# Messwert auslesen                                                       #
############################################################################
def getMeasure():
  currently_available = 0

  while currently_available <= 0:
    MEDAQLib_object.ExecSCmd("Get_Measure")
    currently_available = MEDAQLib_object.DataAvail()

    if MEDAQLib_object.GetLastError() != ERR_CODE.ERR_NOERROR:
      print(MEDAQLib_object.GetError())
      winsound.Beep(500, 1000)

    if currently_available == 0:
      sleep(0.001)
      winsound.Beep(500, 50)

  if currently_available > 0:
    transfered_data = MEDAQLib_object.TransferData(currently_available)

    if MEDAQLib_object.GetLastError() == ERR_CODE.ERR_NOERROR:
      scaled_data = transfered_data[1]
      return scaled_data[0]
    else:
      print(MEDAQLib_object.GetError())
      winsound.Beep(500, 1000)

  return None

#
############################################################################


############################################################################
# Tp fuer definierte Dauer live anzeigen                                  #
############################################################################
def display_Tp_for_duration(duration_sec, display_interval_sec=0.2):
  start_time = time.time()
  last_display_time = 0.0

  print(f"\nStarte Live-Anzeige von Tp fuer {duration_sec} s ...\n")

  while (time.time() - start_time) < duration_sec:
    Tp = getMeasure()

    if isinstance(Tp, float):
      now = time.time()

      if (now - last_display_time) >= display_interval_sec:
        elapsed = now - start_time
        remaining = max(0.0, duration_sec - elapsed)

        print(
          f"\rTp aktuell = {Tp:.{glRound}f} deg C"
          f" | vergangen = {elapsed:6.1f} s"
          f" | rest = {remaining:6.1f} s",
          end="",
          flush=True
        )
        last_display_time = now
    else:
      winsound.Beep(500, 50)

    sleep(0.01)

  print("\n")

#
############################################################################


############################################################################
# Mittelwert fuer Bewertung bilden                                        #
############################################################################
def measure_average_for_evaluation(averaging):
  progress = PacmanProgress(
    total=100,
    width=40,
    cookie_spacing=4,
    text="Status"
  )

  j = 0
  sum_tp = 0.0

  while j < averaging:
    Tp = getMeasure()
    progress.update(j * (100 / averaging))

    if isinstance(Tp, float):
      sum_tp += Tp
      j += 1
    else:
      winsound.Beep(500, 50)

  progress.finish()

  Tp_mean = sum_tp / j
  Tp_mean = round(Tp_mean, glRound)

  return Tp_mean

#
############################################################################


############################################################################
# main                                                                    #
############################################################################
if __name__ == '__main__':

  initVariables()

  MEDAQLib_object = MEDAQLib.CreateSensorInstByName("ME-Bus")

  glRound = 3
  sep == "<TAB>"

  Verbose = 10

  initMEDAQLib()

  dtDateStamp = datetime.now().strftime('%Y.%m.%d')
  dtTimeStamp = datetime.now().strftime('%H:%M:%S')
  gsOutString = gsOutString + (f"{dtDateStamp}{sep}{dtTimeStamp}{sep}")

  readControllerInfo()

  e_Current = readParameterID(50000)

  print(f"Emmissionsgrad = {e_Current}")

  amount = 2
  averaging = 10

  print(f'\nMesspunkte = {amount}')

  i = 1
  while i <= amount:
    print(f'--------------------------------\nMesspunkt {i} <ENTER>')
    #wert = input()



    # 2. danach Bewertung wie bisher mit Mittelwertbildung
    Tp = measure_average_for_evaluation(averaging)

    output_text = f'\n>>>>> Temperatur Pos {i} = {Tp} deg C'

    gsOutString = gsOutString + (f"{sep}{Tp}")


    print(f'{output_text}')


    winsound.Beep(2000, 500)

    if i < amount:
      # Weiter oder nicht?
      print(f'\n<ENTER> fuer weiter, sonst beliebige Taste(n) und <ENTER> ', end="")
      wert = input()
      if wert != "":
        print(f'Breche ab ...')
        # String erweitern ...
        # Messerwet; Status
        # ;Abbruch

        print(f'{i} - {amount}\n\n')

        while i < amount:
          gsOutString = gsOutString + (f"{sep}{sep}canceled")
          i += 1

      else:
        print(f'mache weiter ...')

    i += 1

  
  MEDAQLib_object.CloseSensor()
  MEDAQLib_object.ReleaseSensorInstance()
  print(f'\n... fertig  Taste <ENTER> zum beenden \n\n')
  wert = input()

#
############################################################################
